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
CITATION = re.compile(r'^\[[\d,\s–—-]+\]$')
DASH = re.compile(r'^[–—-]$')

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
    # Chapter 7. Three columns that are routinely conflated and should not be:
    #   commercial_regain  the allowance yarn is bought and sold at (BS 4784:1973)
    #   moisture_regain    what the fibre actually holds at 65% r.h., 20 C
    #   regain_hysteresis  how much MORE it holds coming down from wet than up
    #                      from dry, at the same humidity
    # The engine carries one number per fibre and calls it regain. It is the
    # middle one. The other two have no home in the engine at all, and the third
    # is worth 1-2% of fabric weight on a cloth that has been wet.
    '7.3': {
        'pdf_page': 207, 'y_from': 145, 'y_to': 345,
        'columns': [('commercial_regain', 'conventional allowance', None),
                    ('moisture_regain', '65% r.h.', 65.0),
                    ('regain_hysteresis', '65% r.h.', 65.0)],
        'unit_override': {'commercial_regain': '%', 'moisture_regain': '%',
                          'regain_hysteresis': '%'},
        'paired_check': False,
    },
}

UNITS = {'density': 'g/cm3', 'specific_volume': 'cm3/g',
         'commercial_regain': '%', 'moisture_regain': '%', 'regain_hysteresis': '%'}

# How each printed fibre name is filed. Written out rather than inferred from
# the name, because the classification is a judgement and belongs in one
# reviewable place. `engine` names the key in FIBER_PROPERTIES (yarn-engine.js)
# where the engine already carries a value, so the two can be compared.
FIBRES = {
    # Table 7.3 prints the same fibres under shorter names, and adds several the
    # density tables do not carry.
    'Cotton':                           ('cotton', 'Cotton', 'cellulose', 'natural', 'cellulose', 'cotton'),
    'Mercerised cotton':                ('mercerised_cotton', 'Mercerised cotton', 'cellulose', 'natural', 'cellulose', None),
    'Hemp':                             ('hemp', 'Hemp', 'cellulose', 'natural', 'cellulose', None),
    'Flax':                             ('flax', 'Flax (linen)', 'cellulose', 'natural', 'cellulose', 'linen'),
    'Jute':                             ('jute', 'Jute', 'cellulose', 'natural', 'cellulose', None),
    'Secondary acetate':                ('acetate', 'Acetate / triacetate', 'cellulose', 'regenerated', 'cellulose ethanoate', None),
    'Triacetate':                       ('triacetate', 'Triacetate', 'cellulose', 'regenerated', 'cellulose triethanoate', None),
    'Casein':                           ('casein', 'Regenerated protein (casein)', 'protein', 'regenerated', 'casein', None),
    'Nylon 6.6, Nylon 6':               ('nylon', 'Nylon 6.6 / nylon 6', 'polyamide', 'synthetic', 'polyamide', 'nylon'),
    'Polyester':                        ('polyester', 'Polyester (PET)', 'polyester', 'synthetic', 'polyethylene terephthalate', 'polyester'),
    'Acrylic':                          ('acrylic', 'Acrylic (PAN)', 'vinyl', 'synthetic', 'polyacrylonitrile', 'acrylic'),
    'Modacrylic':                       ('modacrylic', 'Modacrylic', 'vinyl', 'synthetic', 'modacrylic', None),
    'Polyvinyl alcohol':                ('pval', 'Polyvinyl alcohol (vinylal)', 'vinyl', 'synthetic', 'polyvinyl alcohol', None),
    'Polylactic acid':                  ('pla', 'Polylactic acid (PLA)', 'polyester', 'synthetic', 'polylactic acid', None),
    'Meta-aramid (Nomex)':              ('meta_aramid', 'Meta-aramid (Nomex)', 'high_performance', 'synthetic', 'aromatic polyamide', None),

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

    A real column is populated; a stray is not. "Nylon 6.6, nylon 6" ends in a
    bare 6 that reads as a figure and would otherwise invent an extra column for
    the whole table.

    Populated used to mean "in at least half the rows", which was calibrated on
    the density tables where every cell is filled. Table 7.3 leaves a dash in
    two of its three columns for most fibres, so both real columns fell under
    that bar and the table was refused whole.

    So the rule is ranking, not a threshold: take the `expected` best-populated
    clusters. That needs no number chosen in advance, and it fails loudly rather
    than quietly — if the cluster just outside the cut is as populated as the
    one just inside, there is no honest way to say which is a column, and the
    table is refused.
    """
    xs = sorted({round(x) for line in lines for x, t in line if CELL.match(t)})
    clusters = []
    for x in xs:
        if clusters and x - clusters[-1][-1] <= 25:
            clusters[-1].append(x)
        else:
            clusters.append([x])

    scored = []
    for group in clusters:
        lo, hi = min(group) - 12, max(group) + 12
        seen = sum(1 for line in lines
                   if any(lo <= x <= hi and CELL.match(t) for x, t in line))
        scored.append((seen, sum(group) / len(group)))

    if len(scored) < expected:
        return None
    scored.sort(key=lambda r: -r[0])
    kept, dropped = scored[:expected], scored[expected:]
    if dropped and kept[-1][0] <= dropped[0][0]:
        return None                      # the cut falls inside a tie
    if kept[-1][0] == 0:
        return None
    return sorted(c for _, c in kept)


def read_rows(page, y_from, y_to, centres):
    """
    Rows of (name, {column index: (low, high)}), split on the column positions.

    The label is everything NOT sitting in a figure column, which is why the
    columns have to be found first: the 6 in "nylon 6" is a number in the label,
    and deciding what is a figure by looking at the text alone truncates the
    fibre's own name.
    """
    # Everything left of the first column belongs to the fibre's name;
    # everything at or right of it belongs to the figures.
    label_edge = min(centres) - 30 if centres else 1e9

    rows = []
    for line in read_lines(page, y_from, y_to):
        label, cells, ambiguous, qualifiers = [], {}, set(), []
        for x, t in line:
            t = t.strip()
            if not t:
                continue
            if x < label_edge:
                # "[13]" after a fibre name is the book's own citation, not part
                # of the name and not a measurement.
                if not CITATION.match(t):
                    label.append(t)
                continue
            if DASH.match(t):
                continue                 # an empty cell, printed as a dash
            m = CELL.match(t)
            if not m:
                # A word inside the figure region qualifies the number beside
                # it: "up to 12" is a bound, "1.5 or 3" is a choice, "low
                # modulus 7 to high modulus 1.2" is two fibres in one row. The
                # number alone would misrepresent all three, so the row is
                # refused rather than stripped of its qualifier.
                qualifiers.append(t)
                continue
            idx = min(range(len(centres)), key=lambda i: abs(centres[i] - x)) if centres else None
            if m and idx is not None and abs(centres[idx] - x) <= 30:
                if idx in cells:
                    # Two figures in one column. The book writes these as
                    # alternatives or as a pair of reported values — polyester's
                    # allowance is "1.5 or 3", acetate's regain "6, 6.9" — and
                    # there is no way to choose between them here. Taking the
                    # last one, which is what a plain assignment does, would
                    # silently store 3 for a fibre the book gives as 1.5 or 3.
                    ambiguous.add(idx)
                cells[idx] = (float(m.group(1)),
                              float(m.group(2)) if m.group(2) else None)
            else:
                qualifiers.append(t)
        name = ' '.join(label).strip()
        if name and (cells or qualifiers):
            rows.append((name, cells, sorted(ambiguous), qualifiers))
    return rows


def cells_by_property(cells, spec, wanted):
    for idx, (lo, hi) in cells.items():
        if spec['columns'][idx][0] == wanted:
            return (lo, hi)
    return None


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

        for label, cells, ambiguous, qualifiers in rows:
            if qualifiers:
                refused.append({'table': ref, 'name': label,
                                'why': 'the figures are qualified in words ("%s"), so a bare number would misstate them'
                                       % ' '.join(qualifiers)[:40]})
                continue
            if not cells:
                continue
            if ambiguous:
                refused.append({'table': ref, 'name': label,
                                'why': 'two figures share column %s — the book gives alternatives, not one value'
                                       % ', '.join(spec['columns'][i][0] for i in ambiguous)})
                continue
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
            if spec.get('paired_check', True):
                pass
            else:
                # Table 7.3 has its own consistency rules instead of the
                # reciprocal: hysteresis is the amount by which desorption
                # EXCEEDS absorption, so it can never be negative; and the
                # commercial allowance is a trading figure set at or above the
                # measured regain, never below it.
                hyst = cells_by_property(cells, spec, 'regain_hysteresis')
                absorb = cells_by_property(cells, spec, 'moisture_regain')
                comm = cells_by_property(cells, spec, 'commercial_regain')
                if hyst is not None and hyst[0] < 0:
                    refused.append({'table': ref, 'name': label,
                                    'why': 'desorption minus absorption is negative (%.2f)' % hyst[0]})
                    continue
                if comm is not None and absorb is not None:
                    # The allowance is a nominal trading figure that sits inside
                    # or above the measured band, never wholly below it. It is
                    # NOT required to exceed the top of the band: the book gives
                    # viscose as 13% against a measured 12-14%, and an earlier
                    # version of this check called the book wrong for it.
                    floor = absorb[0]
                    if comm[0] < floor - 0.51:
                        refused.append({'table': ref, 'name': label,
                                        'why': 'commercial allowance %.2f is below the whole measured band (from %.2f)' % (comm[0], floor)})
                        continue
                by_cond = {}
            for cond, pair in by_cond.items():
                d, v = pair.get('density'), pair.get('specific_volume')
                if not d or not v:
                    refused.append({'table': ref, 'name': label,
                                    'why': 'condition %s has only one of density and specific volume' % (cond or 'unstated')})
                    row_ok = False
                    break
                # Low density goes with high specific volume, which is why the
                # endpoints cross over here.
                for (dd, vv), which in (((d[0], v[0]), 'value'), ((d[1], v[1]), 'range end')):
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
                # A specific-volume range is printed DESCENDING, because it is
                # the reciprocal of an ascending density range: carbon reads
                # "1.8-2.0" against "0.56-0.55". value_min and value_max have to
                # mean minimum and maximum or a query for "density under 1.5"
                # returns nonsense, so the endpoints are ordered here and the
                # reciprocal check pairs the low density with the HIGH volume.
                if hi is not None and hi < lo:
                    lo, hi = hi, lo
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
                    'unit': UNITS.get(prop, '%'), 'condition': cond, 'rh_pct': rh,
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
