#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Pull a page range out of Morton & Hearle, "Physical Properties of Textile
Fibres" (4th edn, Woodhead 2008), as plain text plus a per-page report on how
much of it survived extraction.

WHY THE REPORT MATTERS
----------------------
The last book taught this the hard way: a PDF text layer renders a paragraph
faithfully and shreds a table, and both come back as "text". Fig 3.1 of the
Gokarneshan book arrived as loose rows of X with the geometry gone, and there
was nothing in the output to say so. So every page here is scored before it is
read: how many characters, how many numbers, whether the page is mostly a
figure, and whether the numeric lines look like rows of a table or like debris.

A page that scores badly is not extracted from — it is read from the page
image instead, or left out and said to be left out.

  python scripts/extract-fibre-book.py 1 30
  python scripts/extract-fibre-book.py 182 186 --raw
"""
import io
import os
import re
import sys

import fitz  # PyMuPDF

BOOK = os.path.join(os.path.dirname(__file__), '..', '..',
                    'Physical properties of textile fibres.pdf')

# The printed page number runs 19 behind the PDF page in the BODY of this book:
# pdf p.20 carries the running head "1 An introduction to fibre structure" and
# the folio 1. The front matter (pdf 1-19) is numbered in roman and the offset
# does not apply to it at all.
#
# This started as 13, carried over from the Gokarneshan book by hand, and was
# wrong. An offset is the sort of constant that is invisible once it is written
# down and poisons every citation after it, so it is checked against the folio
# printed on the page rather than trusted.
BODY_OFFSET = 19
FRONT_MATTER_LAST = 19


def printed_page(pdf_page):
    """The folio printed on the page, or None where roman numerals are used."""
    return None if pdf_page <= FRONT_MATTER_LAST else pdf_page - BODY_OFFSET


def page_report(page):
    text = page.get_text('text')
    words = page.get_text('words')
    images = page.get_images(full=True)
    drawings = len(page.get_drawings())

    numbers = re.findall(r'\d+(?:\.\d+)?', text)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    # A line that is mostly digits and separators is a candidate table row.
    numeric_lines = [ln for ln in lines
                     if len(re.findall(r'\d', ln)) >= 3
                     and len(re.sub(r'[\d\s.,\-–+×/()%]', '', ln)) <= len(ln) * 0.4]

    return {
        'chars': len(text),
        'lines': len(lines),
        'numbers': len(numbers),
        'numeric_lines': len(numeric_lines),
        'images': len(images),
        'drawings': drawings,
        'words': len(words),
        'text': text,
    }


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    first, last = int(sys.argv[1]), int(sys.argv[2])
    raw = '--raw' in sys.argv

    doc = fitz.open(BOOK)
    last = min(last, doc.page_count)

    print('=' * 72)
    print('Morton & Hearle, Physical Properties of Textile Fibres (4th edn)')
    print('PDF pages %d-%d of %d   (printed page = pdf page - %d, verify per batch)'
          % (first, last, doc.page_count, BODY_OFFSET))
    print('=' * 72)

    if not raw:
        print('\nEXTRACTION REPORT — what survived the text layer')
        print('%-6s %7s %6s %7s %6s %6s  %s' %
              ('pdf p', 'chars', 'lines', 'numbers', 'numln', 'figs', 'note'))
        for n in range(first, last + 1):
            r = page_report(doc[n - 1])
            note = []
            if r['chars'] < 400:
                note.append('SPARSE — likely a figure or plate; read the image')
            if r['numeric_lines'] >= 3:
                note.append('has table-like numeric rows — check them against the image')
            if r['images'] > 2:
                note.append('%d images' % r['images'])
            print('%-6d %7d %6d %7d %6d %6d  %s' %
                  (n, r['chars'], r['lines'], r['numbers'], r['numeric_lines'],
                   r['images'], '; '.join(note)))

    print('\n' + '=' * 72)
    print('TEXT')
    print('=' * 72)
    for n in range(first, last + 1):
        r = page_report(doc[n - 1])
        pp = printed_page(n)
        label = ('printed p.%d' % pp) if pp else 'front matter, roman folio'
        print('\n\n───────── pdf p.%d  (%s) ─────────' % (n, label))
        print(r['text'].rstrip())
    return 0


if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.exit(main())
