#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Split Morton & Hearle into lessons, using the book's OWN table of contents.

  python scripts/extract-fibre-lessons.py            -> data/fibre-lessons.json
  python scripts/extract-fibre-lessons.py --summary  -> print the map only

WHY THE BOOK'S CONTENTS AND NOT A DIVISION OF MY OWN
----------------------------------------------------
The PDF carries a 625-entry outline written by the publisher, with the exact
page each section starts on. Any division invented here would be a guess laid
over an authoritative one that is already in the file. So the lessons are the
author's sections, and the only judgement this script makes is where a section
ENDS — which the outline does not state.

HOW SECTION BOUNDARIES ARE FOUND
--------------------------------
A section runs from its own start page to the page the next section starts on.
Where two sections share a page, the page text is cut at the next section's
heading, so the second section's opening paragraph does not get filed under the
first. When the heading cannot be located in the text — a heading rendered as
part of a figure, most often — the whole page is kept and the lesson is marked
so that a reader knows the boundary is page-level rather than exact.

Nothing here interprets the content. It moves text, records where it came from,
and reports what it could not do cleanly.
"""
import io
import json
import os
import re
import sys

import fitz  # PyMuPDF

HERE = os.path.dirname(os.path.abspath(__file__))
BOOK = os.path.join(HERE, '..', '..', 'Physical properties of textile fibres.pdf')
OUT = os.path.join(HERE, '..', 'data', 'fibre-lessons.json')

SOURCE_KEY = 'morton_hearle_2008'
BODY_OFFSET = 19          # verified against the folio printed on pdf p.20 ("1")
FRONT_MATTER_LAST = 19

# The running head and foot sit in fixed bands at the top and bottom of every
# page. Measured on this book: the head block sits at y ~ 49-78 and the folio
# and copyright line at y ~ 634-656, on a 669.7 pt page.
HEAD_BAND = 0.14      # fraction of page height
FOOT_BAND = 0.92

COPYRIGHT = re.compile(r'Woodhead Publishing Limited')
FOLIO = re.compile(r'^\s*\d{1,3}\s*$')
TABLE_CAPTION = re.compile(r'^Table\s+(\d+\.\d+|A[IVX]+\.\d+)\b')
HEADING_BLOCK = re.compile(r'^\d+(?:\.\d+)+\s*\n')


def digit_ratio(text):
    return sum(c.isdigit() for c in text) / max(1, len(text))


def symbol_loss(text):
    """
    Characters the text layer could not decode — private-use codepoints from the
    maths font, mostly. They cluster in the sections that carry equations
    (12.3.4 Thermodynamic relations loses 234 of them), which are exactly the
    sections where a missing glyph changes the meaning rather than the look.
    Counting them per lesson is how a later reader knows to open the page image
    instead of trusting the stored text.
    """
    return sum(1 for c in text if 0xE000 <= ord(c) <= 0xF8FF or ord(c) == 0xFFFD)


def printed_page(pdf_page):
    return None if pdf_page <= FRONT_MATTER_LAST else pdf_page - BODY_OFFSET


def page_content(page):
    """
    A page split into prose and tables.

    Two problems are solved here, both of which silently destroyed data before.

    READING ORDER. PyMuPDF's plain get_text() returns blocks in the order the
    PDF draws them, which for this book puts the big chapter title LAST on a
    chapter-opening page. Splitting sections on that order filed Appendix II —
    the canonical list of fibre names — under nothing at all. The book is
    single column, so sorting blocks by position gives the true reading order.

    FLOATED TABLES. A table is not where its section is. Table 5.1, which holds
    the density of every general-purpose fibre, is anchored at the foot of
    p.165, BELOW the opening paragraph of section 5.4 — while the section that
    cites it, 5.3, ends higher up the page. Cutting the page at the 5.4 heading
    therefore filed the densities under a section about crystallinity, and the
    gate caught it only because it looks for "Cotton (lumen filled)" by name.

    A table cannot be assigned to a section by position, because position is
    exactly what a float discards. So tables are lifted out of the prose flow
    and kept as records of their own, identified by their caption number, which
    is how the text refers to them anyway.
    """
    height = page.rect.height
    blocks = [b for b in page.get_text('blocks') if b[6] == 0]
    blocks.sort(key=lambda b: (round(b[1], 1), round(b[0], 1)))

    body = []
    for x0, y0, x1, y1, text, _no, _type in blocks:
        t = text.strip()
        if not t or COPYRIGHT.search(t) or FOLIO.match(t):
            continue
        top = y0 / height
        # A short block in the head or foot band is the running head, the
        # chapter title repeat, or the folio. A long one is body text that
        # simply starts high or ends low, and is kept.
        if (top < HEAD_BAND or top > FOOT_BAND) and len(t) < 90:
            continue
        body.append(t)

    prose, tables = [], []
    i = 0
    while i < len(body):
        t = body[i]
        m = TABLE_CAPTION.match(t)
        if not m:
            prose.append(t)
            i += 1
            continue

        # The caption opens a table; the rows follow it. They end at the next
        # caption, at a section heading, or at the first block that reads like
        # a paragraph — long, and with almost no digits in it.
        rows = [t]
        i += 1
        while i < len(body):
            nxt = body[i]
            if TABLE_CAPTION.match(nxt) or HEADING_BLOCK.match(nxt):
                break
            if len(nxt) > 150 and digit_ratio(nxt) < 0.03:
                break
            rows.append(nxt)
            i += 1
        tables.append({'ref': m.group(1), 'text': '\n\n'.join(rows)})

    return (re.sub(r'\n{3,}', '\n\n', '\n\n'.join(prose)).strip(), tables)


def page_text(page):
    return page_content(page)[0]


def chapter_of(title, stack):
    """The chapter a heading belongs to, tracked as the outline is walked."""
    m = re.match(r'^Chapter\s+(\d+)\s*:\s*(.+)$', title)
    if m:
        return int(m.group(1)), m.group(2).strip()
    return stack


def section_number(title):
    m = re.match(r'^(\d+(?:\.\d+)+)\s', title)
    return m.group(1) if m else None


def find_heading(page_text, title):
    """
    Where a heading begins in a page's text, or None.

    The outline title and the rendered heading differ in small ways — the
    outline says "1.2.3 Optical and X-ray diffraction studies" while the page
    breaks the number onto its own line — so the number and the words are
    looked for separately and the earlier confident match wins.
    """
    num = section_number(title)
    words = re.sub(r'^\d+(?:\.\d+)*\s*', '', title).strip()
    if not words:
        return None

    # The words as they appear, tolerant of the line breaks PDF text introduces.
    pattern = r'\s+'.join(re.escape(w) for w in words.split())
    m = re.search(pattern, page_text)
    if not m:
        return None
    start = m.start()

    if num:
        # A heading is usually "1.2.3" on its own line just above the words.
        head = page_text.rfind(num, max(0, start - 60), start)
        if head != -1:
            start = head
    return start


def main():
    doc = fitz.open(BOOK)
    toc = doc.get_toc()
    content = [page_content(doc[i]) for i in range(doc.page_count)]
    pages = [c[0] for c in content]
    page_tables = [c[1] for c in content]
    figure_counts = [len(doc[i].get_images(full=True)) for i in range(doc.page_count)]

    # Only leaf-ish entries make useful lessons. A chapter heading that merely
    # repeats its first section would store the same text twice, so entries are
    # kept only where they are not immediately restated by the next one.
    entries = []
    for i, (level, title, page) in enumerate(toc):
        if i + 1 < len(toc):
            nl, nt, npg = toc[i + 1]
            if npg == page and nt.strip() == title.strip():
                continue          # duplicated wrapper entry
            # A "Chapter 5: Fibre density" entry whose first section starts on
            # the same page holds no text of its own — everything under it
            # belongs to 5.1 and the sections after. Keeping it would store a
            # near-empty row and duplicate the page into two lessons. The
            # chapter is not lost: chapter_no and chapter_title ride on every
            # section below it.
            if level <= 2 and npg == page and re.match(r'^(Chapter\s+\d+|Appendix\s+[IVX]+)', title.strip()):
                continue
        entries.append((level, title.strip(), page))

    lessons = []
    chapter = (None, None)
    unresolved = 0

    for i, (level, title, start) in enumerate(entries):
        chapter = chapter_of(title, chapter)
        nxt = entries[i + 1][2] if i + 1 < len(entries) else doc.page_count + 1
        nxt_title = entries[i + 1][1] if i + 1 < len(entries) else None
        end = min(max(start, nxt), doc.page_count)

        parts = []
        exact_start = exact_end = True

        for p in range(start, end + 1):
            text = pages[p - 1]
            if not text:
                continue
            if p == start:
                at = find_heading(text, title)
                if at is None:
                    exact_start = False
                else:
                    text = text[at:]
            if p == nxt and nxt_title:
                at = find_heading(text, nxt_title)
                if at is None:
                    exact_end = False
                    if p != start:
                        continue          # the next section owns this page
                else:
                    text = text[:at]
            parts.append(text.strip())

        body = re.sub(r'\n{3,}', '\n\n', '\n\n'.join(x for x in parts if x)).strip()
        figs = [p for p in range(start, end + 1) if figure_counts[p - 1] > 0]
        chars = len(body)

        # A heading with subsections beneath it holds only its own title before
        # the first child starts. That is the outline working as intended, not
        # a failed extraction, and calling both SPARSE would hide the real
        # failures among 84 sections that were never going to have a body.
        is_container = (i + 1 < len(entries)
                        and entries[i + 1][0] > level
                        and entries[i + 1][2] == start)

        if is_container and chars < 200:
            extraction = 'CONTAINER'
        elif chars < 200:
            extraction = 'SPARSE'
        elif len(figs) >= max(1, (end - start + 1)) and chars < 1200:
            extraction = 'FIGURE_HEAVY'
        else:
            extraction = 'CLEAN'

        if not (exact_start and exact_end):
            unresolved += 1

        lessons.append({
            'source_key': SOURCE_KEY,
            'chapter_no': chapter[0],
            'chapter_title': chapter[1],
            'section_no': section_number(title),
            'title': title,
            'level': min(level, 4),
            'pdf_page_start': start,
            'pdf_page_end': end,
            'page_start': printed_page(start),
            'page_end': printed_page(end),
            'body': body,
            'char_count': chars,
            'symbol_loss': symbol_loss(body),
            'extraction': extraction,
            'figure_pages': figs,
            'boundary_exact': exact_start and exact_end,
        })

    # Tables, as records in their own right. They are lessons in the same store
    # because they are read the same way — looked up by their caption, cited by
    # page — and because the alternative is a second store that has to be kept
    # in step with this one.
    table_count = 0
    for pdf_page, tables in enumerate(page_tables, start=1):
        for tbl in tables:
            caption = tbl['text'].split('\n')[0].strip()
            ch = None
            m = re.match(r'^(\d+)\.', tbl['ref'])
            if m:
                ch = int(m.group(1))
            lessons.append({
                'source_key': SOURCE_KEY,
                'chapter_no': ch,
                'chapter_title': next((l['chapter_title'] for l in lessons
                                       if l['chapter_no'] == ch and l['chapter_title']), None),
                'section_no': tbl['ref'],
                'title': caption,
                'level': 4,
                'pdf_page_start': pdf_page,
                'pdf_page_end': pdf_page,
                'page_start': printed_page(pdf_page),
                'page_end': printed_page(pdf_page),
                'body': tbl['text'],
                'char_count': len(tbl['text']),
                'symbol_loss': symbol_loss(tbl['text']),
                'extraction': 'TABLE',
                'figure_pages': [],
                'boundary_exact': True,
            })
            table_count += 1

    lessons.sort(key=lambda l: (l['pdf_page_start'], l['level'], l['title']))

    payload = {
        'source': {
            'key': SOURCE_KEY,
            'title': 'Physical Properties of Textile Fibres',
            'author': 'W. E. Morton and J. W. S. Hearle',
            'edition': '4th',
            'publisher': 'Woodhead Publishing',
            'year': 2008,
            'identifier': 'ISBN 978-1-84569-220-9',
            'pdf_pages': doc.page_count,
            'page_offset': BODY_OFFSET,
            'note': 'Printed page = PDF page - 19 in the body. Front matter (pdf 1-19) is numbered in roman and the offset does not apply.',
        },
        'lessons': lessons,
    }

    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    by_ex = {}
    for l in lessons:
        by_ex[l['extraction']] = by_ex.get(l['extraction'], 0) + 1
    total_chars = sum(l['char_count'] for l in lessons)

    print('lessons          : %d  (from %d outline entries)' % (len(lessons), len(toc)))
    print('tables lifted out: %d' % table_count)
    print('extraction       : %s' % ', '.join('%s %d' % kv for kv in sorted(by_ex.items())))
    print('page-level bounds: %d lessons (heading not locatable in the text)' % unresolved)
    print('total text       : %s characters' % format(total_chars, ','))
    print('written          : %s' % os.path.normpath(OUT))
    return 0


if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.exit(main())
