#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Turn the density tables of Morton & Hearle chapter 5 into measured rows.

  python scripts/extract-fibre-properties.py   -> data/fibre-properties.json

READ BY POSITION, NOT BY COUNTING
---------------------------------
A printed table is a grid, and the only reliable way to know which column a
figure sits in is where it sits. Counting figures per row fails the moment a
cell is empty, and Table 5.1 has four such rows.

That failure is not academic. Alginate, Teklan, PVC and PLA each print ONE
density where the others print two. Counting says "the first figure, so the
dry one". The coordinates say otherwise: those figures sit at x = 256, which
is the 65% r.h. column, and the dry column is the empty one. Reading them as
dry would have put four measurements under the wrong condition — silently,
and in a table whose whole purpose is to keep conditions apart.

So the cells are clustered into columns by x, and each column is mapped to a
(property, condition) declared per table below.

THE CHECK
---------
Every row prints a density and a specific volume, and the two are reciprocals
by definition. Any row that fails that is refused rather than imported. One
does: the book gives carbon as 1.8-2.0 g/cm3 with specific volume 0.56-0.55,
and 1/2.0 is 0.50, not 0.55. Every other range in the table is self-consistent,
so this is the book's own slip. It is recorded on the row instead of being
quietly corrected to whichever figure looks nicer.
"""
import io
import json
import os
import re
import sys

import fitz  # PyMuPDF

HERE = os.path.dirname(os.path.abspath(__file__))
BOOK = os.path.join(HERE, '..', '..', 'Physical properties of textile fibres.pdf')
OUT = os.path.join(HERE, '..', 'data', 'fibre-properties.json')
SOURCE_KEY = 'morton_hearle_2008'
BODY_OFFSET = 19

CELL = re.compile(r'^(\d+(?:\.\d+)?)(?:[–—-](\d+(?:\.\d+)?))?$')

# Each table: the PDF page it is on, the vertical band its data rows occupy, and
# what each column of figures means, left to right.
TABLES = {
    '5.1': {
        'pdf_page': 184, 'y_from': 445, 'y_to': 640,
        'columns': [('density', 'dry', 0.0), ('density', '65% r.h.', 65.0),
                    ('specific_volume', 'dry', 0.0), ('specific_volume', '65% r.h.', 65.0)],
    },
    '5.2': {
        'pdf_page': 185, 'y_from': 100, 'y_to': 240,
        'columns': [('density', None, None), ('specific_volume', None, None)],
    },
    '5.3': {
        'pdf_page': 185, 'y_from': 310, 'y_to': 460,
        'columns': [('density', None, None), ('specific_volume', None, None)],
    },
}

UNITS = {'density': 'g/cm3', 'specific_volume': 'cm3/g'}

# How each printed fibre name is filed. Written out rather than inferred from
# the name, because the classification is a judgement and belongs in one
# reviewable place. `engine` names the key in FIBER_PROPERTIES (yarn-engine.js)
# where the engine already carries a value, so the two can be compared.
FIBRES = {
    'Cotton (lumen filled)':            ('cotton', 'Cotton', 'cellulose', 'natural', 'cellulose', 'cotton'),
    'Viscose rayon':                    ('viscose', 'Viscose rayon', 'cellulose', 'regenerated', 'cellulose', 'viscose'),
    'Secondary acetate, triacetate':    ('acetate', 'Acetate / triacetate', 'cellulose', 'regenerated', 'cellulose ethanoate', None),
    'Wool':                             ('wool', 'Wool', 'protein', 'natural', 'keratin', 'wool'),
    'Silk':                             ('silk', 'Silk', 'protein', 'natural', 'fibroin', None),
    'Regenerated protein (casein)':     ('casein', 'Regenerated protein (casein)', 'protein', 'regenerated', 'casein', None),
    'Alginate':                         ('alginate', 'Alginate', 'other', 'regenerated', 'alginic acid salt', None),
    'Nylon 6.6, nylon 6':               ('nylon', 'Nylon 6.6 / nylon 6', 'polyamide', 'synthetic', 'polyamide', 'nylon'),
    'Polyester (PET)':                  ('polyester', 'Polyester (PET)', 'polyester', 'synthetic', 'polyethylene terephthalate', 'polyester'),
    'Acrylic (PAN)':                    ('acrylic', 'Acrylic (PAN)', 'vinyl', 'synthetic', 'polyacrylonitrile', 'acrylic'),
    'Polyethylene (high density)':      ('polyethylene', 'Polyethylene (high density)', 'polyolefin', 'synthetic', 'polyethylene', None),
    'Polypropylene':                    ('polypropylene', 'Polypropylene', 'polyolefin', 'synthetic', 'polypropylene', None),
    'Modacrylic (Dynel)':               ('modacrylic_dynel', 'Modacrylic (Dynel)', 'vinyl', 'synthetic', 'modacrylic', None),
    'Modacrylic (Teklan)':              ('modacrylic_teklan', 'Modacrylic (Teklan)', 'vinyl', 'synthetic', 'modacrylic', None),
    'Polyvinyl chloride (PVC)':         ('pvc', 'Polyvinyl chloride (PVC)', 'vinyl', 'synthetic', 'polyvinyl chloride', None),
    'Polylactic acid (PLA)':            ('pla', 'Polylactic acid (PLA)', 'polyester', 'synthetic', 'polylactic acid', None),
    'Glass':                            ('glass', 'Glass', 'inorganic', 'inorganic', 'silicate glass', None),

    'Para-aramid (Kevlar, Twaron)':     ('para_aramid', 'Para-aramid (Kevlar, Twaron)', 'high_performance', 'synthetic', 'aromatic polyamide', None),
    'Aramid (Technora)':                ('aramid_technora', 'Aramid (Technora)', 'high_performance', 'synthetic', 'aromatic copolyamide', None),
    'High-modulus polyethylene (HMPE)': ('hmpe', 'High-modulus polyethylene (HMPE)', 'polyolefin', 'synthetic', 'polyethylene', None),
    'LCP fibre (Vectran)':              ('lcp_vectran', 'LCP fibre (Vectran)', 'high_performance', 'synthetic', 'liquid crystal polyester', None),
    'PBO (Zylon)':                      ('pbo', 'PBO (Zylon)', 'high_performance', 'synthetic', 'polybenzoxazole', None),
    'PIPD (M5)':                        ('pipd', 'PIPD (M5)', 'high_performance', 'synthetic', 'polypyridobisimidazole', None),
    'Carbon':                           ('carbon', 'Carbon', 'carbon', 'synthetic', 'carbon', None),
    'Silicon carbide based':            ('sic_based', 'Silicon carbide based', 'inorganic', 'inorganic', 'silicon carbide', None),
    'Silicon carbide near stoichiometric': ('sic_stoich', 'Silicon carbide, near stoichiometric', 'inorganic', 'inorganic', 'silicon carbide', None),
    'Alumina':                          ('alumina', 'Alumina', 'inorganic', 'inorganic', 'aluminium oxide', None),
    'Alumina/silica':                   ('alumina_silica', 'Alumina / silica', 'inorganic', 'inorganic', 'aluminium oxide, silica', None),
    'Alumina/zirconia':                 ('alumina_zirconia', 'Alumina / zirconia', 'inorganic', 'inorganic', 'aluminium oxide, zirconia', None),
    'Steel':                            ('steel', 'Steel', 'inorganic', 'inorganic', 'steel', None),

    'Polyvinylidene chloride (PVDC)':   ('pvdc', 'Polyvinylidene chloride (PVDC)', 'vinyl', 'synthetic', 'polyvinylidene chloride', None),
    'Polytetrafluorethylene (PTFE)':    ('ptfe', 'Polytetrafluorethylene (PTFE)', 'other', 'synthetic', 'PTFE', None),
    'Polyetheretherketone (PEEK)':      ('peek', 'Polyetheretherketone (PEEK)', 'high_performance', 'synthetic', 'PEEK', None),
    'Polyphenylene sulphide (PPS)':     ('pps', 'Polyphenylene sulphide (PPS)', 'high_performance', 'synthetic', 'PPS', None),
    'Meta-aramid (Nomex)':              ('meta_aramid', 'Meta-aramid (Nomex)', 'high_performance', 'synthetic', 'aromatic polyamide', None),
    'Melamine-formaldehyde (Basofil)':  ('melamine', 'Melamine-formaldehyde (Basofil)', 'other', 'synthetic', 'melamine formaldehyde', None),
    'Novoloid, phenol-aldehyde (Kynol)': ('novoloid', 'Novoloid, phenol-aldehyde (Kynol)', 'other', 'synthetic', 'phenol aldehyde', None),
    'Polyimide (P84)':                  ('polyimide', 'Polyimide (P84)', 'high_performance', 'synthetic', 'polyimide', None),
    'Polyamide-imide (Kermel)':         ('polyamide_imide', 'Polyamide-imide (Kermel)', 'high_performance', 'synthetic', 'polyamide-imide', None),
    'Polybenzimidazole (PBI)':          ('pbi', 'Polybenzimidazole (PBI)', 'high_performance', 'synthetic', 'polybenzimidazole', None),
    'Semi-carbon (oxidised acrylic)':   ('semi_carbon', 'Semi-carbon (oxidised acrylic)', 'carbon', 'synthetic', 'oxidised polyacrylonitrile', None),
}

# Rows the reciprocal test rejects that are the BOOK's arithmetic, not a
# mis-parse. Each has to be argued, not merely listed, and is imported with the
# discrepancy recorded on the row.
KNOWN_BOOK_DISCREPANCIES = {
    ('carbon', 'specific_volume'):
        'The book prints 1.8-2.0 g/cm3 with specific volume 0.56-0.55, but 1/2.0 is 0.50, not 0.55. '
        'Every other range in Tables 5.2 and 5.3 satisfies the reciprocal exactly, so this is the '
        'book\'s own slip. Both figures are stored as printed rather than one being corrected to fit.',
}


def read_lines(page, y_from, y_to):
    """The words of each printed line, left to right, within a vertical band."""
    words = [w for w in page.get_text('words') if y_from <= w[1] <= y_to]
    lines = {}
    for x0, y0, x1, y1, text, *_ in words:
        lines.setdefault(round(y0), []).append((x0, text))
    return [sorted(lines[y]) for y in sorted(lines)]


def figure_columns(lines, expected):
    """
    Where the columns of figures sit, found from the data rather than declared.

    A real column appears in most rows. A stray one appears in a single row and
    is not a measurement at all: "Nylon 6.6, nylon 6" ends in a bare 6, which
    reads as a figure and would otherwise invent a fifth column for the whole
    table.
    """
    xs = sorted({round(x) for line in lines for x, t in line if CELL.match(t)})
    clusters = []
    for x in xs:
        if clusters and x - clusters[-1][-1] <= 25:
            clusters[-1].append(x)
        else:
            clusters.append([x])

    centres = []
    for group in clusters:
        lo, hi = min(group) - 12, max(group) + 12
        seen = sum(1 for line in lines
                   if any(lo <= x <= hi and CELL.match(t) for x, t in line))
        if seen >= len(lines) / 2:
            centres.append(sum(group) / len(group))
    return centres if len(centres) == expected else None


def read_rows(page, y_from, y_to, centres):
    """
    Rows of (name, {column index: (low, high)}), split on the column positions.

    The label is everything NOT sitting in a figure column, which is why the
    columns have to be found first: the 6 in "nylon 6" is a number in the label,
    and deciding what is a figure by looking at the text alone truncates the
    fibre's own name.
    """
    rows = []
    for line in read_lines(page, y_from, y_to):
        label, cells = [], {}
        for x, t in line:
            m = CELL.match(t)
            idx = min(range(len(centres)), key=lambda i: abs(centres[i] - x)) if centres else None
            if m and idx is not None and abs(centres[idx] - x) <= 30:
                cells[idx] = (float(m.group(1)),
                              float(m.group(2)) if m.group(2) else None)
            else:
                label.append(t)
        name = ' '.join(label).strip()
        if name and cells:
            rows.append((name, cells))
    return rows


def main():
    doc = fitz.open(BOOK)
    fibres, properties, refused, discrepancies = {}, [], [], []

    for ref, spec in TABLES.items():
        page = doc[spec['pdf_page'] - 1]
        printed_page = spec['pdf_page'] - BODY_OFFSET
        lines = read_lines(page, spec['y_from'], spec['y_to'])
        centres = figure_columns(lines, len(spec['columns']))
        if centres is None:
            refused.append({'table': ref, 'name': '(whole table)',
                            'why': 'the figures do not form %d columns' % len(spec['columns'])})
            continue
        rows = read_rows(page, spec['y_from'], spec['y_to'], centres)
        if not rows:
            refused.append({'table': ref, 'name': '(whole table)', 'why': 'no rows found in the declared band'})
            continue

        # The column centres are wherever the figures actually cluster. Taking
        # them from the data rather than hard-coding x values means the mapping
        # survives a reflow, and a table with the wrong number of columns is
        # caught here instead of producing quietly mis-filed rows.
        caption = page.get_text('text')
        m = re.search(r'Table\s+' + re.escape(ref) + r'[^\n]*?\[([^\]]+)\]', caption)
        book_refs = m.group(1) if m else None

        for label, cells in rows:
            meta = FIBRES.get(label)
            if not meta:
                refused.append({'table': ref, 'name': label, 'why': 'no classification recorded for this name'})
                continue
            slug, name, gclass, origin, polymer, engine = meta

            # Pair each density with the specific volume measured at the same
            # condition, and hold them to being reciprocals.
            by_cond = {}
            for idx, (lo, hi) in cells.items():
                prop, cond, rh = spec['columns'][idx]
                by_cond.setdefault(cond, {})[prop] = (lo, hi)

            row_ok = True
            for cond, pair in by_cond.items():
                d, v = pair.get('density'), pair.get('specific_volume')
                if not d or not v:
                    refused.append({'table': ref, 'name': label,
                                    'why': 'condition %s has only one of density and specific volume' % (cond or 'unstated')})
                    row_ok = False
                    break
                for (dd, vv), which in ((( d[0], v[0]), 'value'), ((d[1], v[1]), 'range end')):
                    if dd is None or vv is None:
                        continue
                    if abs(vv - 1.0 / dd) > 0.011:
                        key = (slug, 'specific_volume')
                        if key in KNOWN_BOOK_DISCREPANCIES:
                            discrepancies.append({'fibre': slug, 'table': ref, 'which': which,
                                                  'note': KNOWN_BOOK_DISCREPANCIES[key]})
                        else:
                            refused.append({'table': ref, 'name': label,
                                            'why': '%s: specific volume %.2f is not 1/%.2f = %.3f' % (which, vv, dd, 1.0 / dd)})
                            row_ok = False
                            break
                if not row_ok:
                    break
            if not row_ok:
                continue

            fibres[slug] = {'slug': slug, 'name': name, 'generic_class': gclass,
                            'origin': origin, 'polymer': polymer, 'engine_key': engine,
                            'page': printed_page, 'printed_name': label}

            for idx, (lo, hi) in sorted(cells.items()):
                prop, cond, rh = spec['columns'][idx]
                note = None
                if cond is None:
                    note = 'The table prints one figure and names no condition.'
                if (slug, prop) in KNOWN_BOOK_DISCREPANCIES:
                    note = KNOWN_BOOK_DISCREPANCIES[(slug, prop)]
                properties.append({
                    'fibre_slug': slug, 'property': prop,
                    'value': None if hi is not None else lo,
                    'value_min': lo if hi is not None else None,
                    'value_max': hi if hi is not None else None,
                    'unit': UNITS[prop], 'condition': cond, 'rh_pct': rh,
                    'temperature_c': None, 'method': None,
                    'source_key': SOURCE_KEY, 'page': printed_page,
                    'table_ref': 'Table ' + ref, 'book_refs': book_refs,
                    'quality': 'BOOK_TABLE', 'note': note,
                })

    payload = {
        'source': {'key': SOURCE_KEY, 'tables': sorted(TABLES), 'chapter': 5,
                   'page_offset': BODY_OFFSET},
        'fibres': sorted(fibres.values(), key=lambda f: f['slug']),
        'properties': properties,
        'refused': refused,
        'book_discrepancies': discrepancies,
    }
    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    conds = {}
    for p in properties:
        conds[p['condition'] or 'unstated'] = conds.get(p['condition'] or 'unstated', 0) + 1
    print('fibres      : %d' % len(fibres))
    print('measurements: %d rows  (%s)' % (len(properties),
          ', '.join('%s %d' % kv for kv in sorted(conds.items()))))
    print('refused     : %d' % len(refused))
    for r in refused:
        print('    Table %-4s %-38s %s' % (r['table'], r['name'][:38], r['why']))
    print('book slips  : %d' % len(discrepancies))
    for x in discrepancies:
        print('    %s (%s, %s)' % (x['fibre'], x['table'], x['which']))
    print('written     : %s' % os.path.normpath(OUT))
    return 0


if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.exit(main())
