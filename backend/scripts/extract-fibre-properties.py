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
# "20," "16.5," "123,126," — one worker's figure, or several run together. Table
# 11.1 prints a cell as a list of independently reported values rather than as
# one measurement, so its cells are read with this and not with CELL.
LIST_CELL = re.compile(r'^\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*,?$')
CITATION = re.compile(r'^\[[\d,\s–—-]+\]$')
# A leading dash followed by digits is a negative number, not a range with a
# missing start. Only tables that declare `allow_negative` are read this way,
# because everywhere else a dash is an empty cell and reading it as a sign
# would turn every blank into a figure.
SIGNED = re.compile(r'^[–—-](\d+(?:\.\d+)?)$')
DASH = re.compile(r'^[–—-]$')
TIMES = re.compile(r'^[×x\u00d7]$')

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

    # ---- Chapter 13, tensile properties -------------------------------------
    # The engine has never had a real fibre strength. It carries `rkm`, a
    # dimensionless index with cotton set to 1.00 and every other fibre guessed
    # relative to it. These three tables are the measured article, in N/tex.
    #
    # 13.1 is Meredith's 1945 survey — the natural fibres, the early rayons and
    # the wools, measured on one apparatus at one rate, which is why the fibres
    # in it are comparable with each other in a way that a table assembled from
    # different laboratories is not. It prints a work factor, and that column
    # turns the table into its own proof: work of rupture must equal tenacity x
    # breaking extension x work factor, and every row is held to it.
    #
    # 13.2 is the manufactured fibres as they are actually sold — medium- and
    # high-tenacity and staple grades kept apart, which matters because a
    # polyester staple yarn and a polyester tyre yarn differ by 20% in tenacity
    # and the engine has one number for "polyester".
    #
    # 13.7 is the one no calculation here has ever had: what wetting does. Not a
    # property but a RATIO, wet against 65% r.h., and the numbers are severe.
    # Viscose keeps half its strength and three per cent of its initial modulus.
    # That single figure is why a viscose knit comes out of the dyehouse longer
    # and narrower than it went in, and the engine could not say so.
    '13.1': {
        'pdf_page': 309, 'y_from': 370, 'y_to': 620,
        'hierarchical': True, 'label_edge_offset': 25,
        'columns': [('tenacity', '65% r.h., 20 C', 65.0),
                    ('breaking_extension', '65% r.h., 20 C', 65.0),
                    ('work_of_rupture', '65% r.h., 20 C', 65.0),
                    ('initial_modulus', '65% r.h., 20 C', 65.0),
                    ('yield_stress', '65% r.h., 20 C', 65.0),
                    ('yield_strain', '65% r.h., 20 C', 65.0),
                    ('work_factor', '65% r.h., 20 C', 65.0)],
        'temperature_c': 20.0,
        'tensile_check': True,
        'paired_check': False,
    },
    '13.2': {
        'pdf_page': 311, 'y_from': 118, 'y_to': 395,
        'hierarchical': True,
        'columns': [('tenacity', '65% r.h., 20 C', 65.0),
                    ('breaking_extension', '65% r.h., 20 C', 65.0),
                    ('work_of_rupture', '65% r.h., 20 C', 65.0),
                    ('initial_modulus', '65% r.h., 20 C', 65.0)],
        'temperature_c': 20.0,
        'tensile_check': True,
        'paired_check': False,
    },
    # ---- Chapter 11, swelling ---------------------------------------------
    # The other half of what water does. Chapter 13 says the fibre goes soft;
    # this says it also gets BIGGER, and by how much in which direction.
    # Viscose rayon swells 50-114% in cross-sectional AREA and 74-127% by
    # volume, against 0.4-0.5% along its length. Cotton is 21-42% in area.
    # Nylon is 1.6-3.2%. That anisotropy — large across, negligible along — is
    # the mechanism a knit expresses as width change while the length holds.
    #
    # It is NOT fabric shrinkage and nothing here should be read as a shrinkage
    # figure. A fibre swelling 50% in area makes the yarn thicker, which forces
    # the loop to take up differently; how much of that reaches the cloth
    # depends on the structure, and the engine's shrinkage factors stay as they
    # are. This says why the shrinkage happens, not how much.
    #
    # UNIQUE IN THE BOOK: each cell is a LIST. The book collects values from
    # several independent workers and prints them side by side, and the text
    # immediately above the table says so — "there are considerable
    # discrepancies in the values of a given quantity obtained by different
    # people". Collapsing that to one number would state a precision the source
    # explicitly disclaims, so the spread is stored as the range and every
    # reported value is kept on the row.
    '11.1': {
        'pdf_page': 259, 'y_from': 505, 'y_to': 620,
        'multi_value': True, 'label_edge_offset': 40,
        # A cell holding several figures is wide, so the default 25-point gap
        # between column clusters swallowed the axial column into the area one:
        # area's last figure sits at x=257 and axial's first at x=281. Inside a
        # cell the figures are never more than 14 points apart and between
        # columns never less than 24, so anything in between separates them and
        # 18 is the middle of that band.
        'cluster_gap': 18,
        'columns': [('transverse_swelling_diameter', 'immersed in water', None),
                    ('transverse_swelling_area', 'immersed in water', None),
                    ('axial_swelling', 'immersed in water', None),
                    ('volume_swelling', 'immersed in water', None)],
        'swelling_check': True,
        'paired_check': False,
    },
    # ---- Chapter 14, variability ------------------------------------------
    # Two ideas, and the engine has never had either.
    #
    # THE WEAK-LINK EFFECT. A fibre breaks at its weakest place, so the longer
    # the piece tested the more chances there are of a weak place in it and the
    # lower the strength comes out. Table 14.1 measures the same cotton at three
    # test lengths: 0.31 N/tex over 1 cm, 0.43 over 1 mm, 0.59 over 0.1 mm — it
    # nearly doubles. Nylon goes 0.47, 0.50, 0.54, barely moving. Cotton's
    # strength is set by its weak places; nylon's is set by the polymer.
    #
    # This also CHECKS the chapter 13 extraction from outside it. Table 13.1 is
    # measured at 1 cm and gives cotton 0.32 and nylon 0.47; Table 14.1 is a
    # different table on a different page and gives 0.31 and 0.47. Two readings
    # of the same physical fact, taken by this parser from two separate
    # coordinate grids, agreeing. Nothing else in this file has that.
    #
    # HOW MUCH A FIBRE VARIES FROM ITSELF. Table 14.6 is the coefficient of
    # variation between individual fibres in one sample, and the spread across
    # fibre types is enormous: cotton's tenacity varies 43% fibre to fibre,
    # nylon's 7%. That single comparison is behind most of what a spinner knows
    # about the two — why a cotton yarn needs more fibres in its cross-section
    # to come out even, why cotton yarn strength is quoted with a CV and
    # filament nylon is not, and why blending a synthetic into cotton steadies
    # it out of proportion to how much is added.
    '14.1': {
        'pdf_page': 343, 'y_from': 300, 'y_to': 325,
        'columns': [('tenacity', '1 cm test length', None),
                    ('tenacity', '1 mm test length', None),
                    ('tenacity', '0.1 mm test length', None)],
        'weak_link_check': True,
        'paired_check': False,
    },
    '14.3': {
        'pdf_page': 346, 'y_from': 342, 'y_to': 388,
        'columns': [('tenacity', '1 cm test length', None),
                    ('tenacity_sd', '1 cm test length', None),
                    # The third column is Peirce's theory applied to the first
                    # two, not a measurement. It is read so the column count
                    # matches what is printed, and then dropped: a calculated
                    # figure filed beside measured ones is how a model ends up
                    # being cited as evidence for itself.
                    (None, None, None),
                    ('tenacity', '1 mm test length', None)],
        'paired_check': False,
    },
    '14.6': {
        'pdf_page': 354, 'y_from': 528, 'y_to': 592,
        'columns': [('cv_fineness', '1 cm specimens', None),
                    ('cv_breaking_load', '1 cm specimens', None),
                    ('cv_tenacity', '1 cm specimens', None),
                    ('cv_breaking_extension', '1 cm specimens', None)],
        'cv_check': True,
        'paired_check': False,
    },
    # ---- Chapter 25, friction ---------------------------------------------
    # Friction is how a fabric holds together at all. Chapter 3 puts it
    # plainly: "a fabric is a discontinuous solid, which is held together by
    # friction and utilises the strength of the millions of separate fibres."
    # Nothing in this engine has had a number for it.
    #
    # Three things come out of these tables that the engine can use.
    #
    # WOOL FELTS BECAUSE ITS FRICTION HAS A DIRECTION. Wool fibre sliding over
    # wool with its scales measures 0.13 static; sliding against them, 0.61 —
    # nearly five times. Under agitation the fibre can move one way and not the
    # other, so it ratchets root-first and the mass consolidates, permanently.
    # That is felting, complete, in two numbers. No other fibre in the book has
    # a directional friction at all.
    #
    # STICK-SLIP. Static friction always exceeds kinetic, and the size of the
    # gap is how violently a yarn grabs and releases as it runs. Nylon is
    # 0.47/0.40, a ratio of 1.18; wool against its scales is 0.61/0.38, a ratio
    # of 1.61. A high ratio means the tension in the yarn is not steady, and
    # unsteady tension at the needle is unsteady stitch length.
    #
    # GUIDE MATERIAL IS A REAL VARIABLE, not a preference. In Table 25.6(b) the
    # hard smooth guides — steel and porcelain — give a higher friction than a
    # fibre pulley or ceramic for EVERY yarn in the table, and the gap is not
    # small: bright acetate runs at 0.38 over steel and 0.19 over a pulley, half
    # as much. Between the pulley and ceramic there is no consistent winner, so
    # nothing here says ceramic is best; what it says is that the hard guides
    # cost roughly twice the tension, measured rather than asserted.
    #
    # The rows here name a PAIR of surfaces, not a fibre, so each table declares
    # what its rows mean rather than looking them up in FIBRES.
    '25.3': {
        'pdf_page': 738, 'y_from': 105, 'y_to': 252,
        'hierarchical': True, 'keep_citations': True,
        'columns': [('friction_static', None, None),
                    ('friction_kinetic', None, None)],
        'row_map': {
            'Rayon on rayon':                    ('viscose', 'on viscose rayon'),
            # The same pair again from a second reference, at 0.22/0.14 against
            # 0.35/0.26. Two laboratories, one contact, a 60% difference — kept
            # apart by the citation the book prints.
            'Rayon on rayon [30]':               ('viscose', 'on viscose rayon, ref. [30]'),
            'Nylon on nylon':                    ('nylon', 'on nylon'),
            'Wool on wool with scales':          ('wool', 'on wool, with the scales'),
            'Wool on wool against scales':       ('wool', 'on wool, against the scales'),
            'Wool on wool fibres in same direction': ('wool', 'on wool, fibres in the same direction'),
            'Wool on rayon with scales':         ('wool', 'on viscose rayon, with the scales'),
            'Wool on rayon against scales':      ('wool', 'on viscose rayon, against the scales'),
            'Wool on nylon with scales':         ('wool', 'on nylon, with the scales'),
            'Wool on nylon against scales':      ('wool', 'on nylon, against the scales'),
        },
        'friction_check': True,
        'paired_check': False,
    },
    '25.6a': {
        'pdf_page': 742, 'y_from': 112, 'y_to': 232,
        'multi_value': True,
        'columns': [('friction_crossed_fibres', None, None),
                    ('friction_parallel_fibres', None, None)],
        'row_map': {
            'Nylon':                    ('nylon', 'fibre on fibre'),
            'Silk':                     ('silk', 'fibre on fibre'),
            'Viscose rayon':            ('viscose', 'fibre on fibre'),
            'Acetate':                  ('acetate', 'fibre on fibre'),
            'Cotton':                   ('cotton', 'fibre on fibre'),
            'Glass':                    ('glass', 'fibre on fibre'),
            'Jute':                     ('jute', 'fibre on fibre'),
            'Casein':                   ('casein', 'fibre on fibre'),
            'Saran':                    ('pvdc', 'fibre on fibre'),
            'Terylene polyester fibre': ('polyester', 'fibre on fibre'),
            'Wool, with scales':        ('wool', 'fibre on fibre, with the scales'),
            'Wool, against scale':      ('wool', 'fibre on fibre, against the scales'),
        },
        'friction_check': True,
        'paired_check': False,
    },
    '25.6b': {
        'pdf_page': 742, 'y_from': 285, 'y_to': 350,
        'columns': [('friction_over_guide', 'over hard steel', None),
                    ('friction_over_guide', 'over porcelain', None),
                    ('friction_over_guide', 'over a fibre pulley', None),
                    ('friction_over_guide', 'over ceramic', None)],
        'row_map': {
            'Viscose rayon':   ('viscose', None),
            'Acetate, bright': ('acetate', 'bright'),
            'Acetate, dull':   ('acetate_dull', 'dull'),
            'Grey cotton':     ('cotton', 'grey'),
            'Nylon':           ('nylon', None),
            'Linen':           ('flax', None),
        },
        'friction_check': True,
        'paired_check': False,
    },
    # ---- Chapter 24, optical ----------------------------------------------
    # This chapter was read to source `sheen` in fabric-physics.js, and the
    # honest result is that it CANNOT be sourced from here — see the note in
    # that file. What the chapter does give is two real things.
    #
    # 24.3 is the refractive indices, along the fibre and across it. The gap
    # between them, the birefringence, measures how well the molecules are
    # lined up with the fibre axis, and chapter 13 shows it correlating with
    # cotton's tenacity better than fineness does. Polyester's 0.188 against
    # cotton's 0.046 is the most orientated fibre in the table by a factor of
    # four; triacetate and Acrilan run slightly NEGATIVE, meaning their chains
    # lie across the fibre rather than along it, which is why the reader has to
    # accept a signed value here.
    #
    # 24.5 is the one that matters for a fabric advisor. Lustre in cotton
    # tracks the cross-section's ELLIPTICITY — how flat the fibre is — and
    # nothing else: "no correlation was found between lustre and fibre length,
    # linear density, diameter". American FGM at a/b = 3.07 measures 5.7;
    # mercerised cotton at 1.47 measures 13.9. The book states the mechanism
    # outright: mercerisation removes the convolutions and makes the fibres
    # rounder, and that is what raises the lustre. Two and a half times, from
    # geometry alone.
    '24.3': {
        'pdf_page': 721, 'y_from': 210, 'y_to': 360,
        'allow_negative': True,
        'columns': [('refractive_index_parallel', 'light polarised along the fibre', None),
                    ('refractive_index_perpendicular', 'light polarised across the fibre', None),
                    ('birefringence', None, None)],
        'row_map': {
            'Cotton':                   ('cotton', None),
            # One row for two fibres, so it is filed under flax with the pairing
            # said out loud rather than silently claimed for one of them.
            'Ramie and flax':           ('flax', 'measured together with ramie'),
            'Viscose rayon':            ('viscose', None),
            'Secondary acetate':        ('acetate', None),
            'Triacetate':               ('triacetate', None),
            'Wool':                     ('wool', None),
            'Silk':                     ('silk', None),
            'Casein':                   ('casein', None),
            'Vicara (zein)':            ('vicara', None),
            'Nylon':                    ('nylon', None),
            'Terylene polyester fibre': ('polyester', None),
            'Orlon acrylic fibre':      ('acrylic', None),
            'Acrilan acrylic fibre':    ('acrylic_acrilan', None),
            'Polyethylene':             ('polyethylene', None),
            'Glass':                    ('glass', None),
        },
        'optical_check': True,
        'paired_check': False,
    },
    '24.5': {
        'pdf_page': 725, 'y_from': 220, 'y_to': 372,
        'hierarchical': True,
        'columns': [('fibre_ellipticity', None, None),
                    ('lustre', None, None),
                    ('convolutions_per_cm', None, None)],
        # Fifteen cottons, not fifteen fibres. They all file under `cotton` with
        # the variety in the condition, which keeps the fibre list honest and
        # still lets the whole series be queried back as a series.
        'row_map': {
            'American FGM':           ('cotton', 'American FGM'),
            'Peruvian':               ('cotton', 'Peruvian'),
            'Sakel S':                ('cotton', 'Sakel S'),
            'St Kitts Sea Island':    ('cotton', 'St Kitts Sea Island'),
            'Surat':                  ('cotton', 'Surat'),
            'US 12, Sea Island':      ('cotton', 'US 12, Sea Island'),
            'Abassi':                 ('cotton', 'Abassi'),
            'Texas':                  ('cotton', 'Texas'),
            'Barbados Sea Island':    ('cotton', 'Barbados Sea Island'),
            'Sakel CR':               ('cotton', 'Sakel CR'),
            'Egyptian, grown in Peru': ('cotton', 'Egyptian, grown in Peru'),
            'Antigua Sea Island':     ('cotton', 'Antigua Sea Island'),
            'Mercerised A':           ('cotton', 'mercerised A'),
            'Mercerised A B':         ('cotton', 'mercerised B'),
            'Mercerised A C':         ('cotton', 'mercerised C'),
        },
        'lustre_check': True,
        'paired_check': False,
    },
    # ---- Chapter 15, elastic recovery --------------------------------------
    # The single most common complaint about a knitted garment is that it goes
    # out of shape — the elbows bag, the knees seat, the neck opens and stays
    # open. This is that, measured.
    #
    # 15.2 gives elastic recovery at three extensions and two humidities, and
    # the fibres separate completely. Nylon recovers 89% even after being pulled
    # 10%. Viscose recovers 23%. Cotton manages 91% at 1% extension and 52% at
    # 5%, which is the whole story of a cotton tee that fits at the shop and not
    # after a week: at small strains it comes back, and at garment-wearing
    # strains it does not.
    #
    # It is stored at every extension the book gives rather than averaged,
    # because the collapse between 1% and 5% IS the finding. A single "recovery"
    # figure per fibre would erase exactly the thing that matters.
    #
    # 15.1 gives the yield point — the stress beyond which recovery stops being
    # complete — from two different constructions, and the book notes that the
    # stress-strain values run higher than the recovery ones. They do, in every
    # row, which makes the table check itself.
    '15.1': {
        'pdf_page': 363, 'y_from': 318, 'y_to': 400,
        'columns': [('yield_stress', 'yield point from the stress-strain curve', None),
                    ('yield_strain', 'yield point from the stress-strain curve', None),
                    ('yield_stress', 'yield point from the recovery curve', None),
                    ('yield_strain', 'yield point from the recovery curve', None)],
        'row_map': {
            'Cotton':           ('cotton', None),
            'Viscose rayon':    ('viscose', None),
            'Acetate':          ('acetate', None),
            'Stretched rayon':  ('viscose_ht', None),
            'Wool':             ('wool', None),
            'Casein':           ('casein', None),
            'Silk':             ('silk', None),
            'Nylon':            ('nylon', None),
        },
        'yield_check': True,
        'paired_check': False,
    },
    '15.2': {
        'pdf_page': 363, 'y_from': 495, 'y_to': 620,
        'hierarchical': True,
        'columns': [('elastic_recovery', 'from 1% extension, 60% r.h.', 60.0),
                    ('elastic_recovery', 'from 1% extension, 90% r.h.', 90.0),
                    ('elastic_recovery', 'from 5% extension, 60% r.h.', 60.0),
                    ('elastic_recovery', 'from 5% extension, 90% r.h.', 90.0),
                    ('elastic_recovery', 'from 10% extension, 60% r.h.', 60.0),
                    ('elastic_recovery', 'from 10% extension, 90% r.h.', 90.0)],
        'row_map': {
            'Cotton':                                  ('cotton', None),
            'Viscose rayon':                           ('viscose', None),
            'Acetate':                                 ('acetate', None),
            'Wool':                                    ('wool', None),
            'Silk':                                    ('silk', None),
            'Nylon':                                   ('nylon', None),
            'Polyethylene terephthalate (Dacron)':     ('polyester', None),
            'Polyacrylonitrile (Orlon)':               ('acrylic', None),
            'Casein':                                  ('casein', None),
        },
        'recovery_check': True,
        'paired_check': False,
    },
    # ---- Chapter 19, abrasion: READ, AND DELIBERATELY NOT STORED ----------
    # Table 19.7 (p.556) gives abrasion and wear relative to nylon = 100 over
    # fourteen published tests. It is the durability table this engine most
    # wants, and it is not here on purpose.
    #
    # The reader was built and it works: the rotated page transposes cleanly,
    # the ten rows are found, wrapped names are joined to the figures that
    # follow them, and the bands come out ordered exactly as a textile person
    # would expect — polyester and nylon at the top, viscose, acetate and casein
    # two orders of magnitude below.
    #
    # It was dropped over the reference fibre. The caption says the results are
    # "reduced so as to give nylon the value 100", so nylon must read 100 in
    # every column. It does not: two columns print "100, 4" and "100, 73", both
    # at the same 8-point body size as every other figure, so neither is a
    # footnote marker. Under a normalisation to 100 the reference cannot also be
    # 4 in the same column, which means the table's structure is not what this
    # reader thinks it is — there is something in those columns it has not
    # understood.
    #
    # The two ways forward from there were both worse than stopping. Shipping
    # the band gives nylon 4-100, which any textile person would see is wrong.
    # Forcing nylon to 100 and dropping the odd figures is inventing data to fit
    # an assumption. So the table is left out, and this note is the reason, so
    # that the next attempt starts from the actual problem — what the second
    # figure in those two cells is — rather than rebuilding the reader.
    #
    # Nothing downstream depends on it: `pilling_tendency` in yarn-engine
    # remains an unsourced per-spinning-system constant, and the pilling
    # advisory is derived from work of rupture (Tables 13.1/13.2) instead, which
    # is measured and needs no normalisation.
    # ---- Chapter 17, directional effects ------------------------------------
    # Three questions this engine has been answering from unsourced constants.
    #
    # HOW STIFF WILL THE CLOTH FEEL, AND HOW WILL IT HANG. Flexural rigidity is
    # the resistance to bending, and it is what a hand reads as drape. Reported
    # SPECIFIC — per tex squared — so it is a property of the material and not of
    # how fine the fibre happens to be, which is the only form in which fibres
    # can be compared at all: rigidity goes as the square of linear density, so
    # a coarse wool and a microfibre of the same polymer differ by orders of
    # magnitude and neither number says anything about the wool.
    #
    # HOW MUCH WILL IT SPIRAL. Torsional rigidity is the resistance to twisting,
    # and a single jersey spirals because the residual torque in the yarn is
    # never fully taken out. Cotton at 0.16 is four times as stiff in torsion as
    # nylon at 0.041, which is why cotton jersey spirality is a standing problem
    # and nylon's is not. `torque_idx` in yarn-engine has always been a
    # per-spinning-system guess with no source; this is the measured quantity
    # underneath it.
    #
    # Every row satisfies torsional < flexural, which is not a coincidence but
    # the physics — a solid resists bending more than twisting because the shear
    # modulus is always below the tensile one — so the reader holds every row to
    # it.
    #
    # 17.1 and 17.2 BOTH give flexural rigidity and they DISAGREE: Finlayson
    # puts silk at 0.19 and the later work at 0.60, three times apart. Both are
    # stored under their own pages rather than one being preferred, because the
    # disagreement is the honest state of the measurement.
    '17.1': {
        'pdf_page': 435, 'y_from': 556, 'y_to': 618,
        'columns': [('fibre_shape_factor', 'Finlayson', None),
                    ('specific_flexural_rigidity', 'Finlayson', None)],
        'row_map': {
            'Viscose': ('viscose', None), 'Acetate': ('acetate', None),
            'Wool': ('wool', None), 'Silk': ('silk', None),
            'Nylon': ('nylon', None), 'Glass': ('glass', None),
        },
        'bending_check': True,
        'paired_check': False,
    },
    '17.2': {
        'pdf_page': 440, 'y_from': 112, 'y_to': 265,
        'rotated': True, 'hierarchical': True,
        'columns': [('specific_flexural_rigidity', '65% r.h., 20 C', 65.0),
                    ('bending_modulus', '65% r.h., 20 C', 65.0),
                    ('tensile_modulus_gpa', '65% r.h., 20 C', 65.0),
                    ('specific_torsional_rigidity', '65% r.h., 20 C', 65.0),
                    ('shear_modulus', '65% r.h., 20 C', 65.0)],
        'temperature_c': 20.0,
        'row_map': {
            'Cotton':                            ('cotton', None),
            'Viscose rayon Fibro (staple)':      ('viscose', None),
            'Viscose rayon Vincel (high wet modulus)': ('polynosic', 'Vincel'),
            'Secondary acetate':                 ('acetate', None),
            'Triacetate':                        ('triacetate', None),
            'Wool':                              ('wool', None),
            'Silk':                              ('silk', None),
            'Casein Fibrolane':                  ('casein', None),
            'Nylon 6.6 (3 types)':               ('nylon', 'across 3 types'),
            'Polyester fibre Terylene':          ('polyester', None),
            'Acrylic fibre (3 types)':           ('acrylic', 'across 3 types'),
            'Polypropylene':                     ('polypropylene', None),
        },
        'bending_check': True,
        'paired_check': False,
    },
    # WHAT A LOOP COSTS. A yarn in a knitted fabric is not straight — it is bent
    # round a needle and pulled, and the outside of that bend carries far more
    # than its share. Table 17.3 measures exactly that: the strength of a looped
    # yarn as a percentage of the same yarn pulled straight. Cotton keeps 91%.
    # Viscose keeps 58%, so a viscose knit gives up over a third of its yarn
    # strength to the geometry alone, before anything else happens to it. No
    # calculation here has ever accounted for that, and every strength figure the
    # engine quotes is a straight-pull figure.
    '17.3': {
        'pdf_page': 444, 'y_from': 305, 'y_to': 415,
        'multi_value': True,
        'columns': [('loop_strength_pct', 'loop strength as % of straight tensile (Coplan)', None),
                    ('loop_strength_pct', 'loop strength as % of straight tensile (Bohringer and Schieber)', None),
                    ('knot_strength_pct', 'knot strength as % of straight tensile (Berry)', None)],
        'row_map': {
            'Cotton':                  ('cotton', None),
            'Viscose rayon':           ('viscose', None),
            'High-tenacity viscose':   ('viscose_ht', None),
            'Acetate':                 ('acetate', None),
            'Wool':                    ('wool', None),
            'Silk':                    ('silk', None),
            'Nylon':                   ('nylon', None),
            'Orlon acrylic fibre':     ('acrylic', None),
            'Dacron polyester fibre':  ('polyester', None),
            'Fibreglas':               ('glass', None),
        },
        'loop_check': True,
        'paired_check': False,
    },
    # ---- Chapter 16, what repeated loading does ----------------------------
    # Elastic recovery (Table 15.2) answers what happens when a fabric is
    # stretched ONCE. A garment is not stretched once. Table 16.1 cycles fibres
    # to 2% extension over and over and measures how much extension has
    # accumulated by cycle 10 and by cycle 1000, which is the difference between
    # "it fits in the shop" and "it fits after a fortnight".
    #
    # The separation is severe and it is not the strength ordering: nylon has
    # accumulated 0.28% by cycle 10 and cotton 1.98%, seven times as much, from
    # the identical treatment.
    #
    # This is the first table read with cell-level refusal. Every row has one
    # unreadable cell out of four — a footnote mark on linen (its extension was
    # imposed at 1.5%, not 2%, so the figure is genuinely not comparable), the
    # book's own typo "10..8" on viscose — and refusing whole rows would throw
    # away three sound measurements to guard against one bad one. The refused
    # cell is named on the row instead.
    #
    # `x_to` stops the reader before the censored cycles-to-break column, whose
    # cells hold ">5000" and "breaks". Those are real results and they are not
    # numbers; a reader that quietly turned ">5000" into 5000 would be inventing
    # an upper bound the book explicitly declines to give.
    '16.1': {
        'pdf_page': 388, 'y_from': 150, 'y_to': 250,
        'hierarchical': True, 'cell_level_refusal': True, 'x_to': 260,
        'columns': [('cyclic_extension_growth_pct', 'by cycle 10, at 2% imposed extension', None),
                    ('cyclic_extension_growth_pct', 'by cycle 1000, at 2% imposed extension', None),
                    ('cyclic_stress_mn_tex', 'at cycle 10, 2% imposed extension', None),
                    ('cyclic_stress_mn_tex', 'at cycle 1000, 2% imposed extension', None)],
        'row_map': {
            'Cotton':   ('cotton', None),
            'Linen':    ('flax', None),
            'Viscose':  ('viscose', None),
            'Durafil†': ('durafil', None),
            'Acetate':  ('acetate', None),
            'Silk':     ('silk', None),
            'Nylon':    ('nylon', None),
            'Wool':     ('wool', None),
            'Casein':   ('casein', None),
        },
        'cyclic_check': True,
        'paired_check': False,
    },

    # ---- Chapter 6, thermal ------------------------------------------------
    # 6.2 is three fibres and it settles an argument. Packed to the same bulk
    # density, cotton conducts 71 mW/(m K), wool 54 and silk 50 — so wool really
    # is warmer than cotton at equal weight and packing, and not only because it
    # traps more air. The note under the table is the other half: still air is
    # 25, so every one of these is within a factor of three of doing nothing,
    # and most of a fabric's warmth is the air in it rather than the fibre.
    '6.2': {
        'pdf_page': 192, 'y_from': 248, 'y_to': 280,
        'columns': [('thermal_conductivity', 'pad at 0.5 g/cm3 bulk density', None)],
        'row_map': {'Cotton': ('cotton', None), 'Wool': ('wool', None),
                    'Silk': ('silk', None)},
        'thermal_check': True,
        'paired_check': False,
    },

    # 6.5 is the one that matters on a stenter. NYLON AND POLYESTER HAVE A
    # NEGATIVE COEFFICIENT OF LINEAR EXPANSION: heated, they get SHORTER. Every
    # other fibre here lengthens. That is why a polyester fabric has to be heat
    # set and why it comes off the frame narrower than it went on, and the
    # engine has never had the figure.
    #
    # The book sets each value as "4 x 10^-4" with the exponent on the following
    # line, and the minus as a separate word — "- 3". Read naively the minus is
    # an empty cell and nylon is stored as +3, reversing the physics in silence.
    # The unit carries the factor of 10^-4 so only the mantissa is stored.
    '6.5': {
        'pdf_page': 195, 'y_from': 105, 'y_to': 168,
        'allow_negative': True, 'x_to': 225,
        'columns': [('linear_expansion_axial', 'per degree C', None)],
        'row_map': {
            'Cotton': ('cotton', None),
            'Cellulose acetate': ('acetate', None),
            'Nylon fibre': ('nylon', None),
            'Polyester (PET)': ('polyester', 'above 80 C'),
            'Polyethylene': ('polyethylene', None),
            'Polyacryonitrile (PAN)': ('acrylic', None),
        },
        'thermal_check': True,
        'paired_check': False,
    },
    # ---- Chapter 18, what heat does ----------------------------------------
    # THE CEILING ON EVERY DRYING AND SETTING TEMPERATURE. Nylon 6 melts at
    # 215 C and nylon 6.6 at 260 — the same generic fibre, 45 degrees apart, so
    # "nylon" is not a stenter setting. Polypropylene melts at 170, which is
    # below where polyester is normally set, so the two cannot share a frame.
    #
    # The caption underneath is as important as the table: "Cellulosic and
    # protein fibres decompose before melting". Cotton, wool and silk have no
    # melting point at all — they char — which is why a poly-cotton is set for
    # the polyester and the cotton simply endures it. That fact is carried into
    # the note on every row rather than being left to the reader to remember.
    '18.1': {
        'pdf_page': 482, 'y_from': 525, 'y_to': 608,
        'value_before': '°C',
        'property': 'melting_point',
        'note': 'The book adds under this table that cellulosic and protein fibres decompose '
                'before melting, so cotton, wool, silk and the rayons have no melting point at '
                'all — they char. A setting temperature chosen for a synthetic in a blend is '
                'endured by the natural fibre, not shared with it.',
        'row_map': {
            'Polyethylene – low density': ('polyethylene_ld', None),
            '– high density':             ('polyethylene', None),
            'Polypropylene':              ('polypropylene', None),
            'Secondary acetate':          ('acetate', None),
            'Cellulose triacetate':       ('triacetate', None),
            'Nylon 6':                    ('nylon6', None),
            'Nylon 6.6':                  ('nylon', None),
            'Polyester fibre':            ('polyester', None),
        },
    },

    # SLOW HEAT IS A DIFFERENT QUESTION FROM MELTING, and a more useful one: a
    # fabric is not held at its melting point, it is held for hours at 100 to
    # 130 C in drying, setting and storage. After 80 days at 130 C cotton keeps
    # 10% of its strength and polyester keeps 75%. Glass keeps everything. That
    # ordering — and it is not the melting-point ordering — is what decides
    # whether a blend survives a hot finishing route.
    '18.3': {
        'pdf_page': 498, 'y_from': 450, 'y_to': 532,
        'columns': [('strength_retained_pct', 'after 20 days at 100 C', None),
                    ('strength_retained_pct', 'after 20 days at 130 C', None),
                    ('strength_retained_pct', 'after 80 days at 100 C', None),
                    ('strength_retained_pct', 'after 80 days at 130 C', None)],
        'row_map': {
            'Viscose rayon':       ('viscose', None),
            'Cotton':              ('cotton', None),
            'Linen':               ('flax', None),
            'Glass':               ('glass', None),
            'Silk':                ('silk', None),
            'Nylon':               ('nylon', None),
            'Polyester, Terylene': ('polyester', None),
            'Acrylic, Orlon':      ('acrylic', None),
        },
        'heat_ageing_check': True,
        'paired_check': False,
    },
    # ---- Chapter 22, electrical resistance -----------------------------------
    # Static is not a property of a fibre; it is a race between charge arriving
    # and charge leaking away, and what decides the leak is resistance. Table
    # 22.1 gives the resistance directly and, in its last column, the number a
    # factory can act on: THE HUMIDITY AT WHICH THE FIBRE STOPS BEING A
    # PROBLEM.
    #
    #   cotton, flax, viscose      30% r.h.
    #   wool                       55%
    #   silk                       65%
    #   acetate, nylon, polyester  85%
    #   purified acrylic, purified polyester  95%
    #
    # Thirty per cent is below any working floor, so a cellulosic essentially
    # never carries static. Eighty-five is above every working floor, so a
    # synthetic always does. That is the whole of it, and it is why the problem
    # arrived with the synthetics rather than being solved by them.
    #
    # AND THE FINISH IS THE ANSWER, MEASURED. The book prints acrylic and
    # polyester twice, "as received" and "purified": stripping the spin finish
    # moves the threshold from 85% to 95%. What carries the charge away on
    # commercial fibre is not the polymer at all — it is the finish on it, which
    # is why an antistatic is a finish and why scouring one off creates a
    # problem that was not there before.
    '22.1': {
        'pdf_page': 666, 'y_from': 305, 'y_to': 490,
        'hierarchical': True,
        'columns': [('resistance_moisture_slope', None, None),
                    ('log_resistance_at_10pct_moisture', None, None),
                    ('log_resistance', '65% r.h.', 65.0),
                    ('rh_for_static_threshold', 'r.h. at which resistance reaches 1e10 ohm g/m2', None)],
        'row_map': {
            'Cotton':                              ('cotton', None),
            'Washed cotton':                       ('cotton', 'washed'),
            'Mercerised cotton':                   ('mercerised_cotton', None),
            'Flax':                                ('flax', None),
            'Viscose rayon':                       ('viscose', None),
            'Washed viscose rayon':                ('viscose', 'washed'),
            'Acetate':                             ('acetate', None),
            'Silk':                                ('silk', None),
            'Wool':                                ('wool', None),
            'Washed wool':                         ('wool', 'washed'),
            'Nylon':                               ('nylon', None),
            # The same fibre twice, with and without its spin finish. Filed
            # under one slug with the treatment in the condition, because the
            # polymer is identical and the surface is not.
            'Orlon acrylic fibre (as received)':   ('acrylic', 'as received, spin finish on'),
            'Purified Orlon acrylic fibre':        ('acrylic', 'purified, spin finish removed'),
            'Terylene polyester fibre (as received)': ('polyester', 'as received, spin finish on'),
            'Purified Terylene polyester fibre':   ('polyester', 'purified, spin finish removed'),
        },
        'static_check': True,
        'paired_check': False,
    },
    '13.7': {
        'pdf_page': 331, 'y_from': 175, 'y_to': 320,
        'rotated': True, 'hierarchical': True, 'label_edge_offset': 24,
        'columns': [('tenacity_ratio', 'wet / 65% r.h.', None),
                    ('breaking_extension_ratio', 'wet / 65% r.h.', None),
                    ('work_of_rupture_ratio', 'wet / 65% r.h.', None),
                    ('initial_modulus_ratio', 'wet / 65% r.h.', None),
                    ('tenacity_ratio', 'wet 95 C / wet 20 C', None),
                    ('breaking_extension_ratio', 'wet 95 C / wet 20 C', None),
                    ('work_of_rupture_ratio', 'wet 95 C / wet 20 C', None),
                    ('initial_modulus_ratio', 'wet 95 C / wet 20 C', None)],
        'ratio_check': True,
        'paired_check': False,
    },
}

UNITS = {'density': 'g/cm3', 'specific_volume': 'cm3/g',
         'commercial_regain': '%', 'moisture_regain': '%', 'regain_hysteresis': '%',
         # Specific stress, not stress: textile practice divides force by linear
         # density rather than by area, because a fibre's cross-section is
         # neither round nor constant and its mass per unit length is what is
         # actually measured. N/tex is newtons per tex; multiply by density in
         # g/cm3 to get GPa.
         'tenacity': 'N/tex', 'initial_modulus': 'N/tex',
         'work_of_rupture': 'mN/tex', 'yield_stress': 'mN/tex',
         'breaking_extension': '%', 'yield_strain': '%',
         'work_factor': '1',
         'tenacity_ratio': '1', 'breaking_extension_ratio': '1',
         'work_of_rupture_ratio': '1', 'initial_modulus_ratio': '1',
         'transverse_swelling_diameter': '%', 'transverse_swelling_area': '%',
         'axial_swelling': '%', 'volume_swelling': '%',
         'tenacity_sd': 'N/tex',
         'cv_fineness': '%', 'cv_breaking_load': '%', 'cv_tenacity': '%',
         'cv_breaking_extension': '%',
         # A coefficient of friction is a force over a force.
         'friction_static': '1', 'friction_kinetic': '1',
         'friction_crossed_fibres': '1', 'friction_parallel_fibres': '1',
         'friction_over_guide': '1',
         'refractive_index_parallel': '1', 'refractive_index_perpendicular': '1',
         'birefringence': '1', 'fibre_ellipticity': '1',
         # The book's own word. Adderley's scale is relative and has no unit; it
         # is stored because the SERIES is the finding, not any one value.
         'lustre': 'arbitrary', 'convolutions_per_cm': '1/cm',
         'elastic_recovery': '%',
         'abrasion_resistance_index': '1',
         # Rigidity per tex squared, which is how a fibre's bending and twisting
         # stiffness are compared independently of its fineness.
         'specific_flexural_rigidity': 'mN mm2/tex2',
         'specific_torsional_rigidity': 'mN mm2/tex2',
         'fibre_shape_factor': '1',
         'bending_modulus': 'GPa', 'tensile_modulus_gpa': 'GPa',
         'shear_modulus': 'kN/mm2',
         'loop_strength_pct': '%', 'knot_strength_pct': '%',
         'cyclic_extension_growth_pct': '%', 'cyclic_stress_mn_tex': 'mN/tex',
         'thermal_conductivity': 'mW/(m K)',
         # The book prints these as "4 x 10^-4 per degree C". The factor lives
         # in the unit so the stored number is the mantissa the page shows.
         'linear_expansion_axial': '1e-4 per degree C',
         'melting_point': 'degree C', 'strength_retained_pct': '%',
         # Specific resistance along a yarn, as its base-ten logarithm, because
         # it spans eight orders of magnitude across these fibres.
         'log_resistance': 'log10(ohm g/m2)',
         'log_resistance_at_10pct_moisture': 'log10(ohm g/m2)',
         'resistance_moisture_slope': '1',
         'rh_for_static_threshold': '%'}

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
    'Silk':                             ('silk', 'Silk', 'protein', 'natural', 'fibroin', 'silk'),
    'Regenerated protein (casein)':     ('casein', 'Regenerated protein (casein)', 'protein', 'regenerated', 'casein', None),
    'Alginate':                         ('alginate', 'Alginate', 'other', 'regenerated', 'alginic acid salt', None),
    'Nylon 6.6, nylon 6':               ('nylon', 'Nylon 6.6 / nylon 6', 'polyamide', 'synthetic', 'polyamide', 'nylon'),
    'Polyester (PET)':                  ('polyester', 'Polyester (PET)', 'polyester', 'synthetic', 'polyethylene terephthalate', 'polyester'),
    'Acrylic (PAN)':                    ('acrylic', 'Acrylic (PAN)', 'vinyl', 'synthetic', 'polyacrylonitrile', 'acrylic'),
    'Polyethylene (high density)':      ('polyethylene', 'Polyethylene (high density)', 'polyolefin', 'synthetic', 'polyethylene', 'polyethylene'),
    'Polypropylene':                    ('polypropylene', 'Polypropylene', 'polyolefin', 'synthetic', 'polypropylene', 'polypropylene'),
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

    # ---- Chapter 13 -------------------------------------------------------
    # The tensile tables do not give one row per fibre; they give one row per
    # GRADE, and the grades differ by more than the fibres do. Nylon 6.6 runs
    # from 0.37 N/tex as staple to 0.66 as high-tenacity filament: a 78% spread
    # inside a single generic name. Filing all of them under 'nylon' would make
    # the fibre's tenacity depend on which row was imported last.
    #
    # So each grade gets its own slug, and exactly one of them is nominated as
    # the fibre the engine means by that name. The nomination is a judgement,
    # and it is the same judgement every time: THE GRADE USED IN APPAREL YARN.
    # This is a knit and woven advisor, so where the book offers a choice the
    # staple or regular-tenacity row is taken and the tyre-cord, industrial and
    # high-tenacity rows are stored beside it under their own names.
    #
    #   cotton      Uppers, over St Vincent and Bengals. Uppers is American
    #               Upland, which is the cotton nearly all apparel is made of,
    #               and it is the cotton the book itself carries forward into
    #               Table 13.7.
    #   viscose     Fibro, which the caption to Fig. 13.11 identifies as staple
    #               viscose rayon, over Courtaulds continuous filament and over
    #               Tenasco, which is a tyre yarn.
    #   wool        Botany 64s. The Bradford count 64s IS merino, which is what
    #               Table 13.7 calls its wool, so the two tables agree.
    #   polyester   Terylene medium-tenacity.
    #   nylon       nylon 6.6 medium-tenacity.
    #   acrylic     Orlon 42 staple.
    #   elastane    the polyurethane elastomer of Table 13.2. The engine has
    #               carried elastane since it was written and has never had a
    #               measured figure for it.
    #
    # polynosic is deliberately NOT given the engine key 'modal'. Modal is the
    # generic name for high-wet-modulus viscose and polynosic is one class of
    # it, so they are relatives rather than the same thing, and the engine's
    # modal figures stay marked unsourced rather than acquiring a citation that
    # would not survive being checked.
    'Cotton St Vincent':                ('cotton_st_vincent', 'Cotton (St Vincent)', 'cellulose', 'natural', 'cellulose', None),
    'Cotton Upper':                     ('cotton', 'Cotton', 'cellulose', 'natural', 'cellulose', 'cotton'),
    'Cotton Bengals':                   ('cotton_bengals', 'Cotton (Bengals)', 'cellulose', 'natural', 'cellulose', None),
    'Cotton, Uppers':                   ('cotton', 'Cotton', 'cellulose', 'natural', 'cellulose', 'cotton'),
    'Ramie':                            ('ramie', 'Ramie', 'cellulose', 'natural', 'cellulose', None),
    'Viscose rayon Courtaulds continuous- filament':
                                        ('viscose_filament', 'Viscose rayon (continuous filament)', 'cellulose', 'regenerated', 'cellulose', None),
    'Viscose rayon Fibro':              ('viscose', 'Viscose rayon', 'cellulose', 'regenerated', 'cellulose', 'viscose'),
    'Viscose rayon normal':             ('viscose', 'Viscose rayon', 'cellulose', 'regenerated', 'cellulose', 'viscose'),
    'Viscose rayon Tenasco':            ('viscose_tenasco', 'Viscose rayon (Tenasco, tyre yarn)', 'cellulose', 'regenerated', 'cellulose', None),
    'Viscose rayon high-tenacity':      ('viscose_ht', 'Viscose rayon (high-tenacity)', 'cellulose', 'regenerated', 'cellulose', None),
    'Viscose rayon polynosic':          ('polynosic', 'Polynosic (high wet modulus rayon)', 'cellulose', 'regenerated', 'cellulose', None),
    'Acetate (Celanese)':               ('acetate', 'Acetate / triacetate', 'cellulose', 'regenerated', 'cellulose ethanoate', None),
    'Acetate':                          ('acetate', 'Acetate / triacetate', 'cellulose', 'regenerated', 'cellulose ethanoate', None),
    'Fortisan (cellulose)':             ('fortisan', 'Fortisan (saponified acetate)', 'cellulose', 'regenerated', 'cellulose', None),
    'Nylon':                            ('nylon', 'Nylon 6.6 / nylon 6', 'polyamide', 'synthetic', 'polyamide', 'nylon'),
    'Nylon 6.6 medium-tenacity':        ('nylon', 'Nylon 6.6 / nylon 6', 'polyamide', 'synthetic', 'polyamide', 'nylon'),
    'Nylon 6.6 high-tenacity':          ('nylon66_ht', 'Nylon 6.6 (high-tenacity)', 'polyamide', 'synthetic', 'polyamide', None),
    'Nylon 6.6 staple fibre':           ('nylon66_staple', 'Nylon 6.6 (staple)', 'polyamide', 'synthetic', 'polyamide', None),
    'Nylon 6 (Perlon)':                 ('nylon6', 'Nylon 6 (Perlon)', 'polyamide', 'synthetic', 'polyamide', None),
    'Wool Botany 64s':                  ('wool', 'Wool', 'protein', 'natural', 'keratin', 'wool'),
    'Wool, merino':                     ('wool', 'Wool', 'protein', 'natural', 'keratin', 'wool'),
    'Wool Crossbred 56s':               ('wool_crossbred_56s', 'Wool (crossbred 56s)', 'protein', 'natural', 'keratin', None),
    'Wool Crossbred 36s':               ('wool_crossbred_36s', 'Wool (crossbred 36s)', 'protein', 'natural', 'keratin', None),
    'Fibrolane (casein)':               ('casein', 'Regenerated protein (casein)', 'protein', 'regenerated', 'casein', None),
    'Polyester fibre (Terylene) medium-tenacity':
                                        ('polyester', 'Polyester (PET)', 'polyester', 'synthetic', 'polyethylene terephthalate', 'polyester'),
    'Terylene (polyester fibre)':       ('polyester', 'Polyester (PET)', 'polyester', 'synthetic', 'polyethylene terephthalate', 'polyester'),
    'Polyester fibre (Terylene) high-tenacity':
                                        ('polyester_ht', 'Polyester (high-tenacity)', 'polyester', 'synthetic', 'polyethylene terephthalate', None),
    # "stape fibre" is the book's own typo, kept as printed so the key matches
    # what the page actually says.
    'Polyester fibre (Terylene) stape fibre':
                                        ('polyester_staple', 'Polyester (staple)', 'polyester', 'synthetic', 'polyethylene terephthalate', None),
    'Acrylic (Orlon 42 staple-fibre)':  ('acrylic', 'Acrylic (PAN)', 'vinyl', 'synthetic', 'polyacrylonitrile', 'acrylic'),
    'Orlon (acrylic fibre)':            ('acrylic', 'Acrylic (PAN)', 'vinyl', 'synthetic', 'polyacrylonitrile', 'acrylic'),
    'Poly(vinyl alcohol)':              ('pval', 'Polyvinyl alcohol (vinylal)', 'vinyl', 'synthetic', 'polyvinyl alcohol', None),
    'Poly(vinyl chloride)':             ('pvc', 'Polyvinyl chloride (PVC)', 'vinyl', 'synthetic', 'polyvinyl chloride', None),
    'Polyethylene Courlene (low-density)':
                                        ('polyethylene_ld', 'Polyethylene (low density)', 'polyolefin', 'synthetic', 'polyethylene', None),
    'Polyethylene Courlene X3 (high-density)':
                                        ('polyethylene', 'Polyethylene (high density)', 'polyolefin', 'synthetic', 'polyethylene', 'polyethylene'),
    'Polypropylene (Ulstron)':          ('polypropylene', 'Polypropylene', 'polyolefin', 'synthetic', 'polypropylene', 'polypropylene'),
    # "Polyprpylene" is the book's typo too.
    'Polyprpylene fibre':               ('polypropylene', 'Polypropylene', 'polyolefin', 'synthetic', 'polypropylene', 'polypropylene'),
    'Elastomer polyurethane':           ('elastane', 'Elastane (polyurethane elastomer)', 'elastomer', 'synthetic', 'segmented polyurethane', 'elastane'),
    'Elastomer rubber':                 ('rubber', 'Rubber', 'elastomer', 'natural', 'polyisoprene', None),
    'Fibreglass':                       ('glass', 'Glass', 'inorganic', 'inorganic', 'silicate glass', None),
    'Steel wire':                       ('steel', 'Steel', 'inorganic', 'inorganic', 'steel', None),

    # ---- Chapter 14 -------------------------------------------------------
    # Table 14.3 names four cotton varieties. Uppers is the same variety the
    # engine takes its cotton from, so it files under 'cotton' — at a different
    # page, and therefore as a separate measurement, which is the point: it is
    # a second laboratory's figure for the same cotton and it differs (0.288
    # against 0.32), which is exactly the fibre-to-fibre variation Table 14.6
    # goes on to quantify.
    'Sakel':                            ('cotton_sakel', 'Cotton (Sakel)', 'cellulose', 'natural', 'cellulose', None),
    'Uppers':                           ('cotton', 'Cotton', 'cellulose', 'natural', 'cellulose', 'cotton'),
    'St Vincent':                       ('cotton_st_vincent', 'Cotton (St Vincent)', 'cellulose', 'natural', 'cellulose', None),
    'Ishan':                            ('cotton_ishan', 'Cotton (Ishan)', 'cellulose', 'natural', 'cellulose', None),
    # Table 14.6 measures the bast fibres as one group rather than separately.
    # Storing it under a group slug keeps that honest; splitting it into flax,
    # jute, hemp and ramie would put four measurements where the book took one.
    'Bast fibres':                      ('bast_fibres', 'Bast fibres (flax, hemp, jute, ramie)', 'cellulose', 'natural', 'cellulose', None),
    'Rayon':                            ('viscose', 'Viscose rayon', 'cellulose', 'regenerated', 'cellulose', 'viscose'),

    # Bright and dull acetate are the same polymer with different surfaces, and
    # friction is a surface property: the delustred yarn runs at half the
    # friction of the bright one over a fibre pulley. They are separate rows in
    # the book and separate fibres here.
    'Acetate, dull':                    ('acetate_dull', 'Acetate (dull, delustred)', 'cellulose', 'regenerated', 'cellulose ethanoate', None),

    'Durafil†':                         ('durafil', 'Durafil (Lilienfeld rayon, 1948)', 'cellulose', 'regenerated', 'cellulose', None),
    'Vicara (zein)':                    ('vicara', 'Vicara (zein protein)', 'protein', 'regenerated', 'zein', None),
    'Acrilan acrylic fibre':            ('acrylic_acrilan', 'Acrylic (Acrilan)', 'vinyl', 'synthetic', 'polyacrylonitrile', None),
}

# The first printed name that defines each slug, so a table which names rows by
# contact pair ("Wool on rayon") can still reach the fibre's classification
# without repeating it.
FIBRE_BY_SLUG = {}
for _printed, _meta in FIBRES.items():
    FIBRE_BY_SLUG.setdefault(_meta[0], _printed)


# Rows the reciprocal test rejects that are the BOOK's arithmetic, not a
# mis-parse. Each has to be argued, not merely listed, and is imported with the
# discrepancy recorded on the row.
KNOWN_BOOK_DISCREPANCIES = {
    ('viscose_tenasco', 'work_factor'):
        'Table 13.1 gives Tenasco as 0.27 N/tex at 16.9% with a work of rupture of 19.7 mN/tex '
        'and a work factor of 0.50, but 0.27 x 16.9 x 0.50 x 10 is 22.8, not 19.7. The work '
        'factor that fits the other three figures is 0.43. Every other row in the table satisfies '
        'the identity to within 4.6% and this one misses by 13.7%, so it is the book\'s misprint '
        'rather than a reading error. All four figures are stored as printed; none is corrected.',

    ('carbon', 'specific_volume'):
        'The book prints 1.8-2.0 g/cm3 with specific volume 0.56-0.55, but 1/2.0 is 0.50, not 0.55. '
        'Every other range in Tables 5.2 and 5.3 satisfies the reciprocal exactly, so this is the '
        'book\'s own slip. Both figures are stored as printed rather than one being corrected to fit.',
}


def placed_words(page, rotated):
    """
    Every word as (across, down, text) in the coordinates the table is READ in.

    Table 13.7 is set sideways on the page, so its printed rows run down the
    page and its printed columns run across it. PyMuPDF reports the position a
    word is drawn at, which for that table is the rotated position: the whole
    fibre list shares one y and each column of ratios shares one x. Everything
    below — column clustering, the label edge, the indent test — assumes the
    printed geometry, so the rotation is undone once, here, and nothing further
    down has to know about it.

    The mapping is a quarter turn: the printed across-axis is -y (the text
    advances towards the top of the page), and the printed down-axis is x.
    """
    for x0, y0, x1, y1, text, *_ in page.get_text('words'):
        if rotated:
            yield (-y1, x0, text)
        else:
            yield (x0, y0, text)


def read_lines(page, y_from, y_to, rotated=False):
    """The words of each printed line, left to right, within a vertical band."""
    lines = {}
    for across, down, text in placed_words(page, rotated):
        if y_from <= down <= y_to:
            lines.setdefault(round(down), []).append((across, text))
    return [sorted(lines[y]) for y in sorted(lines)]


def figure_columns(lines, expected, multi_value=False, cluster_gap=25, x_to=None):
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
    pattern = LIST_CELL if multi_value else CELL
    xs = sorted({round(x) for line in lines for x, t in line
                 if pattern.match(t) and (x_to is None or x <= x_to)})
    clusters = []
    for x in xs:
        if clusters and x - clusters[-1][-1] <= cluster_gap:
            clusters[-1].append(x)
        else:
            clusters.append([x])

    scored = []
    for group in clusters:
        lo, hi = min(group) - 12, max(group) + 12
        seen = sum(1 for line in lines
                   if any(lo <= x <= hi and pattern.match(t) for x, t in line))
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


def read_before_unit(page, y_from, y_to, rotated, unit_token, row_map):
    """
    Rows of (name, value) for a table that has no column to align on.

    Table 18.1 is a list, not a grid: the melting point is set immediately after
    the fibre's name, so the figure starts at x = 115 for "Nylon 6" and x = 189
    for "Polyethylene - low density". There is no column, and a reader that
    looks for one finds nothing or invents one.

    But the layout states itself perfectly well without a column: every value is
    the number immediately before the unit. That is unambiguous — the label
    "Nylon 6.6" contains numbers and neither of them precedes a degree sign —
    and it needs no coordinate at all, so a reflow cannot break it.
    """
    rows = []
    for line in read_lines(page, y_from, y_to, rotated):
        value, label = None, []
        for pos, (x, t) in enumerate(line):
            t = t.strip()
            if t == unit_token and pos > 0:
                m = CELL.match(line[pos - 1][1].strip())
                if m:
                    value = float(m.group(1))
                break
            label.append(t)
        # Drop the figure itself off the end of the label.
        if value is not None and label and CELL.match(label[-1]):
            label.pop()
        name = ' '.join(label).strip()
        if name and value is not None and name in row_map:
            rows.append((name, value))
    return rows


def read_all_figures(page, y_from, y_to, rotated, label_edge, row_map):
    """
    Every figure on each declared row, with no column assignment at all.

    Table 19.7 defeats column reading three ways at once: fourteen conditions
    labelled only A to N and defined on another page, cells holding two or three
    figures from different workers, and fibre names that wrap onto a second line
    which ALSO carries data. Any one is handled elsewhere in this file; together
    the chance of a figure landing under the wrong condition is high, and a
    wrong abrasion number is worse than none.

    But the table does not need column reading to be useful, because the book
    is not claiming a number. It prints fourteen tests precisely BECAUSE they
    disagree — polyester runs from 21 to 696 across them — and what survives
    that disagreement is the ordering, which is emphatic and consistent.

    So this reads the row and nothing else: the declared name, then every figure
    to the right of the label. A wrapped continuation is any left-margin line
    whose label is not in `row_map`, which makes the row inventory a declared
    fact the gate can check rather than an inference that can slip.
    """
    rows, current = [], None
    for line in read_lines(page, y_from, y_to, rotated):
        label = ' '.join(t for x, t in line if x < label_edge and not CITATION.match(t)).strip()
        figures = []
        for x, t in line:
            if x < label_edge:
                continue
            for piece in t.replace(',', ' ').split():
                m = CELL.match(piece)
                if m:
                    figures.append(float(m.group(1)))
                    if m.group(2):
                        figures.append(float(m.group(2)))
        if label and label in row_map:
            current = {'name': label, 'figures': figures}
            rows.append(current)
        elif current is not None:
            # A wrapped name ("polyester fibres" under "Terylene, Dacron"), or a
            # line that is only the tail of a cell. Either way its figures
            # belong to the row above.
            current['figures'].extend(figures)
            if label:
                current['name'] += ' ' + label
    return rows


def read_rows(page, y_from, y_to, centres, rotated=False,
              label_edge_offset=30, hierarchical=False, multi_value=False,
              keep_citations=False, allow_negative=False,
              cell_level_refusal=False, x_to=None):
    """
    Rows of (name, {column index: (low, high)}), split on the column positions.

    The label is everything NOT sitting in a figure column, which is why the
    columns have to be found first: the 6 in "nylon 6" is a number in the label,
    and deciding what is a figure by looking at the text alone truncates the
    fibre's own name.
    """
    # Everything left of the first column belongs to the fibre's name;
    # everything at or right of it belongs to the figures.
    #
    # The offset is per-table because it is a trade-off, not a constant: too
    # small and a qualifying word inside the figure region ("up to 12" in Table
    # 7.3) gets read as part of the fibre's name instead of refusing the row;
    # too large and the last word of a long name gets read as a figure.
    #
    # Two tables carry it explicitly. Table 13.1 must: "Crossbred 56s" reaches
    # to 27 points short of its first column, so the default 30 cuts the wool
    # grade off and refuses the row. Table 13.7 need not, quite — "Terylene
    # (polyester fibre)" clears the default by a single point — but one point is
    # not a margin, and a margin that survives by rounding is one that has not
    # been chosen. Widening the offset to 45 does cut the name, and the gate
    # catches it, which is the evidence that this line is load-bearing.
    label_edge = min(centres) - label_edge_offset if centres else 1e9
    # Some tables carry columns this reader has no business in. Table 16.1 puts
    # a censored cycles-to-break count and two energy-normalised columns to the
    # right of the four that matter, and every one of them is full of words.
    # Declaring where the wanted region ends is honest and keeps the column
    # ranking from picking the loudest columns rather than the right ones.
    right_edge = x_to if x_to is not None else 1e9

    lines = read_lines(page, y_from, y_to, rotated)

    # Where the outer level of the label column starts. Tables 13.1, 13.2 and
    # 13.7 group their rows: "Viscose rayon" on one line, then "high-tenacity"
    # and "polynosic" indented beneath it. The indent is the only thing that
    # says so, and without it the stored fibre is called "polynosic" with no
    # record that it is a rayon, or worse, "high-tenacity" — which appears under
    # viscose rayon AND under nylon 6.6 in the same table.
    outer = min((min(x for x, t in line if x < label_edge)
                 for line in lines
                 if any(x < label_edge for x, t in line)), default=0.0)

    rows = []
    parent, last = None, None
    for line in lines:
        label, cells, ambiguous, qualifiers, lists = [], {}, set(), [], {}
        ranged = set()
        pending_sign = False
        refused_cells = []
        for pos, (x, t) in enumerate(line):
            nxt = line[pos + 1] if pos + 1 < len(line) else None
            t = t.strip()
            if not t:
                continue
            if x > right_edge:
                continue
            if x < label_edge:
                # "[13]" after a fibre name is the book's own citation, not part
                # of the name and not a measurement — except where the same pair
                # is measured twice from two references and the citation is the
                # only thing telling the rows apart. Table 25.3 prints "Rayon on
                # rayon" twice, at 0.35 and at 0.22; dropping "[30]" from the
                # second collapses it onto the first and the disagreement
                # disappears without trace.
                if keep_citations or not CITATION.match(t):
                    label.append(t)
                continue
            if (allow_negative and DASH.match(t) and nxt is not None
                    and CELL.match(nxt[1]) and 0 < nxt[0] - x < 14):
                # "– 3" set as two words. Table 6.5 prints the coefficient of
                # thermal expansion this way, and nylon's and polyester's are
                # NEGATIVE — they contract on heating, which is the whole basis
                # of heat setting. Read as a dash the minus is skipped as an
                # empty cell and the next token is stored as +3, silently
                # reversing the physics. The pair is joined here instead.
                pending_sign = True
                continue
            if TIMES.match(t):
                continue
            if CITATION.match(t):
                # The book's reference column sits to the right of the figures
                # in some tables. It is not a measurement and its brackets stop
                # it being read as one, but without this it would be treated as
                # a word among the figures and refuse the whole row.
                continue
            if DASH.match(t):
                continue                 # an empty cell, printed as a dash
            if allow_negative:
                neg = SIGNED.match(t)
                if neg:
                    idxn = min(range(len(centres)), key=lambda i: abs(centres[i] - x))
                    if abs(centres[idxn] - x) <= 30:
                        cells[idxn] = (-float(neg.group(1)), None)
                        continue
            if multi_value:
                # Table 25.6 puts three different kinds of cell in one column:
                # "0.47" is one measurement, "0.20-0.25" is a range, and
                # "0.29, 0.57" is two workers who disagree. They mean different
                # things and must not be flattened into each other, so the kind
                # is recorded with the values and settled once the whole cell
                # has been read.
                mm = CELL.match(t)
                if mm:
                    vals = [float(mm.group(1))]
                    if mm.group(2):
                        vals.append(float(mm.group(2)))
                elif LIST_CELL.match(t):
                    vals = [float(v) for v in t.strip(',').split(',') if v.strip()]
                else:
                    qualifiers.append(t)
                    continue
                idx = min(range(len(centres)), key=lambda i: abs(centres[i] - x))
                if abs(centres[idx] - x) > 45:
                    qualifiers.append(t)
                    continue
                if mm and mm.group(2):
                    ranged.add(idx)
                lists.setdefault(idx, []).extend(vals)
                continue
            m = CELL.match(t)
            if not m:
                # A word inside the figure region qualifies the number beside
                # it: "up to 12" is a bound, "1.5 or 3" is a choice, "low
                # modulus 7 to high modulus 1.2" is two fibres in one row. The
                # number alone would misrepresent all three, so the row is
                # refused rather than stripped of its qualifier.
                #
                # Except where a table declares otherwise. Table 16.1 has one
                # unreadable cell per row out of four — a footnote mark, a
                # censored ">5000", the book's own "10..8" — and refusing the
                # whole row throws away three good measurements to protect
                # against one bad one. Where a table says so, the CELL is
                # refused and named and the rest of the row is kept.
                if cell_level_refusal:
                    refused_cells.append(t)
                    continue
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
                sign = -1.0 if pending_sign else 1.0
                pending_sign = False
                cells[idx] = (sign * float(m.group(1)),
                              (sign * float(m.group(2))) if m.group(2) else None)
            else:
                qualifiers.append(t)
        name = ' '.join(label).strip()

        if multi_value and not name and lists and rows:
            for idx, vals in lists.items():
                rows[-1][4].setdefault(idx, []).extend(vals)
            rows[-1][5].update(ranged)
            rows[-1][6].extend(refused_cells)
            continue

        if multi_value:
            if name and (lists or qualifiers):
                rows.append((name, cells, sorted(ambiguous), qualifiers, lists, set(ranged), refused_cells))
            continue

        if not hierarchical:
            if name and (cells or qualifiers):
                rows.append((name, cells, sorted(ambiguous), qualifiers, {}, set(), refused_cells))
            continue

        # Three kinds of line, told apart by indent and by whether they carry
        # figures. The rules are exhaustive, so a line the book sets in a way
        # not covered here produces a name that matches nothing in FIBRES and
        # is refused — loudly — rather than being filed under the wrong fibre.
        indented = bool(label) and min(x for x, t in line if x < label_edge) > outer + 4
        if not label:
            continue
        if not cells and not qualifiers:
            if indented and last is not None:
                # A continuation of the name above: "Acetate" then "(Celanese)",
                # "Courlene X3" then "(high-density)".
                rows[last] = (rows[last][0] + ' ' + name,) + rows[last][1:]
            else:
                # A group heading: it names the rows indented beneath it.
                parent = name
            continue
        full = (parent + ' ' + name) if (indented and parent) else name
        if not indented:
            # An outer row can still head a group — Table 13.1 prints figures
            # for "Viscose rayon" itself and then indents Fibro and Tenasco
            # under it — so the parent is set, not cleared.
            parent = name
        rows.append((full, cells, sorted(ambiguous), qualifiers, {}, set(), refused_cells))
        last = len(rows) - 1
    return rows


def tensile_slip(cells, spec, slug):
    """
    Why this tensile row should not be believed, or None.

    Two relations tie the four tensile figures together, and both come from what
    the quantities MEAN rather than from any expectation about a particular
    fibre, so they hold for cotton and for Kevlar alike.

    Work of rupture is the area under the stress-strain curve. The work factor
    is that area as a fraction of the rectangle around it, so

        work of rupture = work factor x tenacity x breaking extension

    exactly, once the units are reconciled: tenacity is N/tex, extension a
    percentage and work of rupture mN/tex, which puts a factor of 10 in.
    Table 13.1 prints the work factor, so it checks itself: a column
    mis-assigned by one place breaks the identity immediately. Table 13.2 does
    not print it, so the factor is derived instead and required to be a
    fraction, because an area cannot exceed the rectangle around it.

    Initial modulus is the slope at the origin. Every fibre in these tables has
    a stress-strain curve that lies above the chord to its breaking point, so
    the initial slope cannot be shallower than that chord. Glass and the
    elastomers come closest, being nearly linear to break, which is why the
    comparison allows 10%.
    """
    ten = cells_by_property(cells, spec, 'tenacity')
    ext = cells_by_property(cells, spec, 'breaking_extension')
    wor = cells_by_property(cells, spec, 'work_of_rupture')
    mod = cells_by_property(cells, spec, 'initial_modulus')
    wf = cells_by_property(cells, spec, 'work_factor')
    if not (ten and ext and wor and mod):
        return 'the row is missing one of tenacity, extension, work of rupture, initial modulus'

    # Ranges are printed low-to-high on both, so the endpoints pair straight
    # across: a fibre at the weak end of its band also breaks at the low
    # extension the table gives.
    for which in (0, 1):
        t, e, w = ten[which], ext[which], wor[which]
        if t is None or e is None or w is None:
            continue
        rect = t * e * 10.0
        if rect <= 0:
            return 'tenacity or extension is zero'
        if wf is not None and wf[which] is not None:
            want = rect * wf[which]
            known = (slug, 'work_factor') in KNOWN_BOOK_DISCREPANCIES
            if abs(w - want) > max(0.5, 0.06 * want) and not known:
                return ('work of rupture %.4g does not match tenacity x extension x work '
                        'factor = %.4g' % (w, want))
        else:
            f = w / rect
            if not (0.20 <= f <= 1.0):
                return ('work of rupture %.4g implies a work factor of %.2f, which is not '
                        'the area under a stress-strain curve' % (w, f))
        secant = t * 100.0 / e
        if mod[which] is not None and mod[which] < 0.9 * secant:
            return ('initial modulus %.4g is below the chord to the breaking point, %.4g'
                    % (mod[which], secant))
    return None


def swelling_slip(lists, spec):
    """
    Why this swelling row should not be believed, or None.

    Only one relation here is safe to insist on, and it is the one that follows
    from geometry rather than from any expectation about fibres: a body cannot
    swell more in cross-sectional area than it does in volume, since the volume
    change is the area change compounded with the length change and no fibre in
    this table gets shorter in water.

    What is NOT checked is area against diameter, and that omission is the
    book's own point. Section 11.2.3 says diameter swelling "is not a sound way
    of expressing transverse swelling of a fibre with an irregular
    cross-section, since it will vary according to the position in which the
    'diameter' is drawn", and acetate proves it: 9-14% by diameter against 6-8%
    by area, which is impossible for a circle and perfectly ordinary for the
    lobed cross-section acetate actually has. A check there would reject the
    row the text exists to explain.

    The values inside a cell are not one measurement either. They are several
    workers' results, and the paragraph above the table says they disagree, so
    the spread between them is data and not error.
    """
    def span(prop):
        for idx, vals in lists.items():
            if spec['columns'][idx][0] == prop and vals:
                return min(vals), max(vals)
        return None

    for idx, vals in lists.items():
        for v in vals:
            if not (0 <= v <= 300):
                return '%s reports %.4g%%, which is not a swelling' % (
                    spec['columns'][idx][0], v)

    area, vol = span('transverse_swelling_area'), span('volume_swelling')
    if area and vol:
        if vol[1] < area[0]:
            return ('every reported volume swelling (%g-%g%%) is below every reported '
                    'area swelling (%g-%g%%)' % (vol[0], vol[1], area[0], area[1]))
    return None


def weak_link_slip(cells, spec):
    """
    Why this weak-link row should not be believed, or None.

    A fibre breaks at its weakest place, so a shorter specimen contains fewer
    weak places and must test at least as strong. That ordering is the whole
    content of the weak-link effect and it cannot go the other way, which makes
    it a check that needs nothing but the row itself: the columns run 1 cm,
    1 mm, 0.1 mm, so the figures must not decrease along them.

    A column read one place out of order breaks it immediately, and so does a
    row whose label was cut short and picked up a figure from its own name.
    """
    order = ['1 cm test length', '1 mm test length', '0.1 mm test length']
    seq = []
    for cond in order:
        for idx, (lo, hi) in cells.items():
            if spec['columns'][idx][1] == cond:
                seq.append((cond, lo))
    for (c1, v1), (c2, v2) in zip(seq, seq[1:]):
        if v2 < v1 - 1e-9:
            return ('tenacity falls from %.4g at %s to %.4g at %s, but a shorter '
                    'specimen cannot be weaker' % (v1, c1, v2, c2))
    return None


def cv_slip(cells, spec):
    """
    Why this coefficient-of-variation row should not be believed, or None.

    A coefficient of variation is a standard deviation over a mean, as a
    percentage. It cannot be negative, and above about 100% the mean stops
    meaning anything for a quantity that cannot go below zero — the highest in
    this table is cotton's breaking load at 46%.
    """
    for idx, (lo, hi) in cells.items():
        for v in (lo, hi):
            if v is None:
                continue
            if not (0 < v <= 100):
                return ('%s is %.4g%%, which is not a coefficient of variation'
                        % (spec['columns'][idx][0], v))
    if len(cells) != len(spec['columns']):
        return '%d of the %d columns are missing' % (
            len(spec['columns']) - len(cells), len(spec['columns']))
    return None


def friction_slip(cells, spec):
    """
    Why this friction row should not be believed, or None.

    Two things hold for every coefficient of friction, and neither depends on
    knowing the materials.

    It is a force divided by a force, so it is positive; and although it is not
    bounded by 1 in general — rubber on rubber exceeds it — nothing in a textile
    context comes near 2, so a figure above that is a units slip rather than a
    surprising fibre.

    Static friction is the force needed to start sliding and kinetic the force
    needed to keep it going, and starting is never easier than continuing. So
    where a row prints both, static cannot be the smaller. That ordering is what
    makes the pair worth storing at all: the gap between them is the stick-slip,
    and a row where they came out the wrong way round has had its columns
    swapped.
    """
    for idx, (lo, hi) in cells.items():
        for v in (lo, hi):
            if v is None:
                continue
            if not (0 < v <= 2.0):
                return '%s is %.4g, which is not a coefficient of friction' % (
                    spec['columns'][idx][0], v)

    st = cells_by_property(cells, spec, 'friction_static')
    ki = cells_by_property(cells, spec, 'friction_kinetic')
    if st and ki and st[0] is not None and ki[0] is not None:
        if st[0] < ki[0] - 1e-9:
            return ('static friction %.4g is below kinetic %.4g, but starting a slide '
                    'is never easier than continuing one' % (st[0], ki[0]))
    return None


def optical_slip(cells, spec):
    """
    Why this refractive-index row should not be believed, or None.

    The birefringence is DEFINED as the difference between the two indices, so
    the row proves itself: if the printed difference is not the printed
    subtraction, a column has been read in the wrong place. That is the whole
    check, and it is exact rather than approximate — the book prints all three
    to the same precision.

    The indices themselves must also be above 1, since light does not travel
    faster in a fibre than in vacuum, and below 2, since nothing organic comes
    close. Polyester is the highest here at 1.725.
    """
    par = cells_by_property(cells, spec, 'refractive_index_parallel')
    per = cells_by_property(cells, spec, 'refractive_index_perpendicular')
    bir = cells_by_property(cells, spec, 'birefringence')
    if not (par and per and bir):
        return 'the row is missing one of the two indices or the birefringence'
    for label, v in (('n parallel', par[0]), ('n perpendicular', per[0])):
        if not (1.0 < v < 2.0):
            return '%s is %.4g, which is not a refractive index for a fibre' % (label, v)
    want = par[0] - per[0]
    if abs(bir[0] - want) > 0.0011:
        return ('birefringence %.4g is not n(parallel) - n(perpendicular) = %.4g'
                % (bir[0], want))
    return None


def lustre_slip(cells, spec):
    """
    Why this lustre row should not be believed, or None.

    Ellipticity is a ratio of the long axis to the short one, so it cannot be
    below 1 — a value under 1 would mean the axes had been divided the other way
    up. Cotton convolutions run around 20-35 per cm and lustre on Adderley's
    arbitrary scale runs 5-15; both are bounded loosely, because the point of
    the table is the trend and not any single figure.
    """
    ell = cells_by_property(cells, spec, 'fibre_ellipticity')
    lus = cells_by_property(cells, spec, 'lustre')
    con = cells_by_property(cells, spec, 'convolutions_per_cm')
    if not ell or not lus:
        return 'the row is missing its ellipticity or its lustre'
    if not (1.0 <= ell[0] <= 10.0):
        return 'ellipticity %.4g is not a ratio of a long axis to a short one' % ell[0]
    if not (0 < lus[0] <= 100):
        return 'lustre %.4g is off the scale the table uses' % lus[0]
    if con is not None and not (0 < con[0] <= 100):
        return 'convolutions %.4g per cm is not a cotton fibre' % con[0]
    return None


def recovery_slip(cells, spec):
    """
    Why this elastic-recovery row should not be believed, or None.

    A recovery is a percentage of the imposed extension that comes back, so it
    lies between 0 and 100. And it can only get worse as the fibre is pulled
    further: stretching past the point where recovery was already incomplete
    cannot make more of it come back. Every row in Table 15.2 obeys that at both
    humidities, so a row where recovery RISES with extension has had its columns
    read out of order.
    """
    by_ext = {}
    for idx, (lo, hi) in cells.items():
        prop, cond, rh = spec['columns'][idx]
        if prop != 'elastic_recovery':
            continue
        if not (0 <= lo <= 100):
            return 'recovery %.4g is not a percentage' % lo
        ext = float(cond.split('%')[0].replace('from', '').strip())
        by_ext.setdefault(rh, []).append((ext, lo))
    for rh, series in by_ext.items():
        series.sort()
        for (e1, v1), (e2, v2) in zip(series, series[1:]):
            if v2 > v1 + 0.5:
                return ('recovery at %g%% r.h. rises from %g to %g as the extension goes '
                        'from %g%% to %g%%, which is not something a fibre does'
                        % (rh, v1, v2, e1, e2))
    return None


def yield_slip(cells, spec):
    """
    Why this yield-point row should not be believed, or None.

    The book observes that the yield values taken from stress-strain curves run
    higher than those taken from recovery curves, and every row bears it out.
    That is the check: it is the book's own reading of its own table, so a row
    that breaks it has been read wrongly here rather than measured wrongly
    there.
    """
    cols = spec['columns']
    def at(prop, cond):
        for idx, (lo, hi) in cells.items():
            if cols[idx][0] == prop and cols[idx][1] == cond:
                return lo
        return None
    ss = at('yield_stress', 'yield point from the stress-strain curve')
    rc = at('yield_stress', 'yield point from the recovery curve')
    for label, v in (('stress-strain', ss), ('recovery', rc)):
        if v is not None and v <= 0:
            return 'the %s yield stress is %.4g' % (label, v)
    if ss is not None and rc is not None and ss < rc:
        return ('the stress-strain yield stress %.4g is below the recovery one %.4g, '
                'against the book\'s own observation that it runs higher' % (ss, rc))
    return None


def bending_slip(cells, spec):
    """
    Why this bending/torsion row should not be believed, or None.

    A solid resists bending more than it resists twisting, always, because the
    shear modulus of a material is below its tensile modulus — for an isotropic
    solid by a factor of about 2.6, and for a drawn fibre with its chains along
    the axis by very much more. So specific torsional rigidity cannot exceed
    specific flexural rigidity, and every row in Table 17.2 obeys it. A row where
    it does not has had its two rigidity columns read the wrong way round, which
    is the one mistake this table invites: they are the same units, printed in
    the same format, three columns apart.

    The shape factor is how far the material sits from the fibre's own centre,
    measured against a solid circle. Glass is 1.0 by definition of being round;
    silk's triangular section is 0.59. It cannot be negative and nothing solid
    exceeds a circle by much.
    """
    flex = cells_by_property(cells, spec, 'specific_flexural_rigidity')
    tors = cells_by_property(cells, spec, 'specific_torsional_rigidity')
    shape = cells_by_property(cells, spec, 'fibre_shape_factor')

    if shape is not None and not (0 < shape[0] <= 1.5):
        return 'shape factor %.4g is not a ratio to a circular section' % shape[0]
    for label, v in (('flexural rigidity', flex), ('torsional rigidity', tors)):
        if v is not None and not (0 < v[0] <= 10):
            return '%s %.4g is outside anything a textile fibre measures' % (label, v[0])
    if flex is not None and tors is not None:
        # Compare like with like: the low end of one against the low end of the
        # other, since a range is a range of the same fibre.
        if tors[0] > flex[0]:
            return ('torsional rigidity %.4g exceeds flexural rigidity %.4g, which no solid '
                    'does — the two columns have been read the wrong way round'
                    % (tors[0], flex[0]))
    return None


def loop_slip(lists, spec):
    """
    Why this loop/knot strength row should not be believed, or None.

    These are percentages of the same yarn's straight tensile strength, so they
    lie between 0 and 100: bending a yarn round a needle or tying it in a knot
    cannot make it stronger than pulling it straight. Glass at 8.4% is the floor
    and it is real — a brittle fibre loses almost everything to a bend.
    """
    for idx, vals in lists.items():
        for v in vals:
            if not (0 < v <= 100):
                return ('%s is %g, and a looped yarn cannot be stronger than the same yarn '
                        'pulled straight' % (spec['columns'][idx][0], v))
    return None


def cyclic_slip(cells, spec):
    """
    Why this cyclic-loading row should not be believed, or None.

    Extension accumulates; it does not un-accumulate. A fibre that has grown
    0.28% by its tenth cycle cannot have grown less than that by its
    thousandth, because the growth already happened. So the 1000-cycle figure
    must be at least the 10-cycle one, and a row where it is not has had the two
    columns read in the wrong order.

    The stress needed to reach the same 2% extension falls as the fibre
    softens under repeated loading, so it goes the other way — but the book has
    rows where it rises slightly, so that is reported and not enforced.
    """
    cols = spec['columns']
    def at(prop, cond):
        for idx, (lo, hi) in cells.items():
            if cols[idx][0] == prop and cols[idx][1] == cond:
                return lo
        return None
    e10 = at('cyclic_extension_growth_pct', 'by cycle 10, at 2% imposed extension')
    e1k = at('cyclic_extension_growth_pct', 'by cycle 1000, at 2% imposed extension')
    for v in (e10, e1k):
        if v is not None and not (0 <= v <= 50):
            return 'accumulated extension %.4g%% is not something a 2%% cycle produces' % v
    if e10 is not None and e1k is not None and e1k < e10 - 1e-9:
        return ('extension accumulated by cycle 1000 (%.4g%%) is below that by cycle 10 '
                '(%.4g%%), and growth does not undo itself' % (e1k, e10))
    return None


def thermal_slip(cells, spec):
    """
    Why this thermal row should not be believed, or None.

    Thermal conductivity is positive and, for a fibre pad, of the order of still
    air: the book's own note gives air as 25 mW/(m K) and no fibre in Table 6.2
    reaches three times it.

    Linear expansion is the one property here that is genuinely SIGNED. Nylon
    and polyester contract on heating and everything else lengthens, so the
    check cannot demand a positive value — it can only demand that the figure is
    of a plausible size. A fibre whose length changed by more than a per cent
    per degree would not survive being ironed.
    """
    cond = cells_by_property(cells, spec, 'thermal_conductivity')
    exp = cells_by_property(cells, spec, 'linear_expansion_axial')
    if cond is not None and not (0 < cond[0] <= 500):
        return 'thermal conductivity %.4g mW/(m K) is not a textile fibre' % cond[0]
    if exp is not None and not (-100 <= exp[0] <= 100):
        return 'linear expansion %.4g is outside anything a fibre does' % exp[0]
    return None


def heat_ageing_slip(cells, spec):
    """
    Why this heat-ageing row should not be believed, or None.

    These are percentages of the fibre's original strength, so they lie between
    0 and 100 — heat does not make a fibre stronger over eighty days.

    And damage accumulates. A fibre that has kept 92% after twenty days at a
    temperature cannot have kept more than that after eighty days at the same
    temperature, and one that has kept 92% at 100 C cannot keep more at 130 C.
    Both orderings hold in every row of the table, so a row that breaks either
    has had its columns read out of order — which is the standing risk in a
    table whose four columns are the same quantity at four conditions.
    """
    cols = spec['columns']
    def at(cond):
        for idx, (lo, hi) in cells.items():
            if cols[idx][1] == cond:
                return lo
        return None
    d20_100 = at('after 20 days at 100 C')
    d20_130 = at('after 20 days at 130 C')
    d80_100 = at('after 80 days at 100 C')
    d80_130 = at('after 80 days at 130 C')
    for v in (d20_100, d20_130, d80_100, d80_130):
        if v is not None and not (0 <= v <= 100):
            return 'strength retained %.4g%% is not a percentage of the original' % v
    if d20_100 is not None and d80_100 is not None and d80_100 > d20_100:
        return ('more strength is retained after 80 days at 100 C (%.4g%%) than after 20 '
                '(%.4g%%), and heat damage does not undo itself' % (d80_100, d20_100))
    if d20_130 is not None and d80_130 is not None and d80_130 > d20_130:
        return ('more strength is retained after 80 days at 130 C (%.4g%%) than after 20 '
                '(%.4g%%)' % (d80_130, d20_130))
    if d20_100 is not None and d20_130 is not None and d20_130 > d20_100:
        return ('more strength survives 130 C than 100 C over the same 20 days '
                '(%.4g%% against %.4g%%)' % (d20_130, d20_100))
    return None


def static_slip(cells, spec):
    """
    Why this resistance row should not be believed, or None.

    A humidity is a percentage. A logarithm of resistance is a small positive
    number — the values here run from 6.8 to 14, which is eight orders of
    magnitude of actual resistance, and that spread is exactly why the book
    prints logarithms.

    The physical tie is between the two: a fibre that is more resistant at 65%
    r.h. needs a HIGHER humidity to fall to the threshold, because getting there
    means picking up more water. So the threshold cannot go down as the
    resistance goes up, and a row where it does has had the two columns crossed.
    That comparison is made across the table rather than within a row, so it
    lives in the gate; what is checked here is that each figure is the kind of
    number it claims to be.
    """
    rh = cells_by_property(cells, spec, 'rh_for_static_threshold')
    lr = cells_by_property(cells, spec, 'log_resistance')
    l10 = cells_by_property(cells, spec, 'log_resistance_at_10pct_moisture')
    if rh is not None and not (0 < rh[0] <= 100):
        return 'a static threshold of %.4g%% r.h. is not a humidity' % rh[0]
    for label, v in (('log resistance at 65% r.h.', lr),
                     ('log resistance at 10% moisture', l10)):
        if v is not None and not (0 < v[0] <= 25):
            return '%s is %.4g, which is not a base-ten logarithm of a resistance' % (label, v[0])
    return None


def ratio_slip(cells, spec):
    """
    Why this row of Table 13.7 should not be believed, or None.

    These are ratios of one measurement to another, so the only thing that can
    be said about them without knowing the fibre is that they are positive and
    finite. The band is set wide deliberately: acrylic's breaking extension
    really does go up more than fourfold in boiling water, and viscose's initial
    modulus really does fall to a fiftieth of its conditioned value. A tighter
    band would refuse the two rows the table exists to report.

    What is NOT allowed is a gap. Every fibre in this table has all eight
    ratios, so a missing one means a column was lost, not that the book left a
    cell empty.
    """
    for idx, (lo, hi) in cells.items():
        for v in (lo, hi):
            if v is None:
                continue
            if not (0.001 <= v <= 10.0):
                return ('%s is %.4g, which is not a ratio of two measurements'
                        % (spec['columns'][idx][0], v))
    if len(cells) != len(spec['columns']):
        return ('%d of the %d ratios are missing'
                % (len(spec['columns']) - len(cells), len(spec['columns'])))
    return None


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
        rotated = spec.get('rotated', False)

        if spec.get('value_before'):
            got = read_before_unit(page, spec['y_from'], spec['y_to'], rotated,
                                   spec['value_before'], spec['row_map'])
            missing = [n for n in spec['row_map'] if not any(r[0] == n for r in got)]
            if missing:
                refused.append({'table': ref, 'name': '(whole table)',
                                'why': 'declared rows not found: ' + ', '.join(missing)})
                continue
            for name_printed, value in got:
                slug, row_condition = spec['row_map'][name_printed]
                meta = FIBRES.get(FIBRE_BY_SLUG.get(slug, ''))
                if not meta:
                    refused.append({'table': ref, 'name': name_printed,
                                    'why': 'row maps to slug "%s", which no fibre defines' % slug})
                    continue
                name, gclass, origin, polymer, engine = meta[1:]
                fibres.setdefault(slug, {'slug': slug, 'name': name, 'generic_class': gclass,
                                         'origin': origin, 'polymer': polymer,
                                         'engine_key': engine,
                                         'page': printed_page, 'printed_name': name_printed})
                properties.append({
                    'fibre_slug': slug, 'property': spec['property'],
                    'value': value, 'value_min': None, 'value_max': None,
                    'unit': UNITS.get(spec['property'], '1'),
                    'condition': row_condition, 'rh_pct': None,
                    'temperature_c': None, 'method': None,
                    'source_key': SOURCE_KEY, 'page': printed_page,
                    'table_ref': 'Table ' + ref, 'book_refs': None,
                    'quality': 'BOOK_TABLE', 'note': spec.get('note'),
                })
            continue

        if spec.get('collect_all'):
            got = read_all_figures(page, spec['y_from'], spec['y_to'], rotated,
                                   spec['label_edge'], spec['row_map'])
            missing = [n for n in spec['row_map'] if not any(r['name'].startswith(n) for r in got)]
            if missing:
                refused.append({'table': ref, 'name': '(whole table)',
                                'why': 'declared rows not found: ' + ', '.join(missing)})
                continue
            for row in got:
                slug = spec['row_map'][next(n for n in spec['row_map'] if row['name'].startswith(n))]
                vals = row['figures']
                if len(vals) < 2:
                    refused.append({'table': ref, 'name': row['name'],
                                    'why': 'only %d figure(s) found on the row' % len(vals)})
                    continue
                meta = FIBRES.get(FIBRE_BY_SLUG.get(slug, ''))
                if not meta:
                    refused.append({'table': ref, 'name': row['name'],
                                    'why': 'row maps to slug "%s", which no fibre defines' % slug})
                    continue
                name, gclass, origin, polymer, engine = meta[1:]
                fibres.setdefault(slug, {'slug': slug, 'name': name, 'generic_class': gclass,
                                         'origin': origin, 'polymer': polymer,
                                         'engine_key': engine,
                                         'page': spec['pdf_page'] - BODY_OFFSET,
                                         'printed_name': row['name']})
                properties.append({
                    'fibre_slug': slug, 'property': spec['property'],
                    'value': None, 'value_min': min(vals), 'value_max': max(vals),
                    'unit': UNITS.get(spec['property'], '1'),
                    'condition': spec['condition'], 'rh_pct': None,
                    'temperature_c': None, 'method': None,
                    'source_key': SOURCE_KEY, 'page': spec['pdf_page'] - BODY_OFFSET,
                    'table_ref': 'Table ' + ref, 'book_refs': None,
                    'quality': 'BOOK_TABLE',
                    'value_count': len(vals),
                    'cell_kind': 'list',
                    'note': 'The band across %d figures the book prints for this fibre over 14 '
                            'separate tests: %s. They disagree by more than an order of '
                            'magnitude because flat rubbing, edge rubbing, flexing and '
                            'laundering wear a fabric by different mechanisms. Only the '
                            'ORDERING between fibres survives that, and no mean of these is '
                            'meaningful.' % (len(vals), ', '.join('%g' % v for v in sorted(vals))),
                })
            continue

        lines = read_lines(page, spec['y_from'], spec['y_to'], rotated)
        centres = figure_columns(lines, len(spec['columns']), spec.get('multi_value', False),
                                 spec.get('cluster_gap', 25), spec.get('x_to'))
        if centres is None:
            refused.append({'table': ref, 'name': '(whole table)',
                            'why': 'the figures do not form %d columns' % len(spec['columns'])})
            continue
        rows = read_rows(page, spec['y_from'], spec['y_to'], centres, rotated,
                         spec.get('label_edge_offset', 30),
                         spec.get('hierarchical', False),
                         spec.get('multi_value', False),
                         spec.get('keep_citations', False),
                         spec.get('allow_negative', False),
                         spec.get('cell_level_refusal', False),
                         spec.get('x_to'))
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

        for label, cells, ambiguous, qualifiers, lists, ranged, refused_cells in rows:
            if qualifiers:
                refused.append({'table': ref, 'name': label,
                                'why': 'the figures are qualified in words ("%s"), so a bare number would misstate them'
                                       % ' '.join(qualifiers)[:40]})
                continue
            # A multi-value table fills `lists`, not `cells`, so testing only
            # `cells` here dropped every row of Table 11.1 — with no refusal
            # recorded, because a skip is not a refusal. The table came through
            # the column check, produced nine rows, and then vanished.
            if not cells and not lists:
                continue
            if ambiguous:
                refused.append({'table': ref, 'name': label,
                                'why': 'two figures share column %s — the book gives alternatives, not one value'
                                       % ', '.join(spec['columns'][i][0] for i in ambiguous)})
                continue
            # Friction is not a property of a fibre; it is a property of two
            # surfaces touching. "Wool on rayon, against scales" is one
            # measurement and there is no fibre it belongs to on its own, so
            # these tables name the pair in the row and the table declares what
            # each row means. The slug is the fibre being rubbed and the
            # counterface goes into the condition, which keeps the row
            # answerable to "what is wool's friction?" without pretending the
            # counterface was not there.
            row_map = spec.get('row_map')
            if row_map is not None:
                if label not in row_map:
                    refused.append({'table': ref, 'name': label,
                                    'why': 'this table declares no meaning for this row'})
                    continue
                slug, row_condition = row_map[label]
                meta = FIBRES.get(FIBRE_BY_SLUG.get(slug, ''))
                if not meta:
                    refused.append({'table': ref, 'name': label,
                                    'why': 'row maps to slug "%s", which no fibre defines' % slug})
                    continue
                name, gclass, origin, polymer, engine = meta[1:]
            else:
                row_condition = None
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
            if spec.get('static_check'):
                why = static_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            if spec.get('heat_ageing_check'):
                why = heat_ageing_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            if spec.get('cyclic_check'):
                why = cyclic_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            if spec.get('thermal_check'):
                why = thermal_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            if spec.get('bending_check'):
                why = bending_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            if spec.get('recovery_check'):
                why = recovery_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            if spec.get('yield_check'):
                why = yield_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            if spec.get('optical_check'):
                why = optical_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            if spec.get('lustre_check'):
                why = lustre_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            if spec.get('friction_check') and cells:
                why = friction_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            if spec.get('weak_link_check'):
                why = weak_link_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            elif spec.get('cv_check'):
                why = cv_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            if spec.get('multi_value'):
                as_cells = {i: (min(v), max(v)) for i, v in lists.items()}
                why = (swelling_slip(lists, spec) if spec.get('swelling_check')
                       else friction_slip(as_cells, spec) if spec.get('friction_check')
                       else loop_slip(lists, spec) if spec.get('loop_check')
                       else None)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                fibres.setdefault(slug, {'slug': slug, 'name': name, 'generic_class': gclass,
                                         'origin': origin, 'polymer': polymer, 'engine_key': engine,
                                         'page': printed_page, 'printed_name': label})
                for idx, vals in sorted(lists.items()):
                    prop, cond, rh = spec['columns'][idx]
                    cond = ', '.join(x for x in (row_condition, cond) if x) or None
                    lo, hi = min(vals), max(vals)
                    # Three kinds of cell, three different statements. "0.47" is
                    # one measurement. "0.20-0.25" is one worker's range.
                    # "0.29, 0.57" is two workers who disagree. They come out of
                    # the page as the same pair of numbers and mean quite
                    # different things, so the note has to say which.
                    if idx in ranged and len(vals) == 2:
                        kind, why = 'range', 'The table prints this as a range.'
                    elif idx in ranged:
                        kind, why = 'mixed', None
                    elif len(vals) == 1:
                        kind, why = 'single', 'The table prints one value.'
                    else:
                        kind, why = 'list', (
                            'The table collects %d independently reported values: %s. '
                            'Stored as their range; the book itself notes "considerable '
                            'discrepancies in the values of a given quantity obtained by '
                            'different people".' % (len(vals), ', '.join('%g' % v for v in vals)))
                    if kind == 'mixed':
                        refused.append({'table': ref, 'name': label,
                                        'why': 'a cell mixes a printed range with separate figures, '
                                               'and the two cannot be stored as one span'})
                        break
                    properties.append({
                        'fibre_slug': slug, 'property': prop,
                        'value': lo if len(vals) == 1 else None,
                        'value_min': None if len(vals) == 1 else lo,
                        'value_max': None if len(vals) == 1 else hi,
                        'unit': UNITS.get(prop, '%'), 'condition': cond, 'rh_pct': rh,
                        'temperature_c': spec.get('temperature_c'), 'method': None,
                        'source_key': SOURCE_KEY, 'page': printed_page,
                        'table_ref': 'Table ' + ref, 'book_refs': book_refs,
                        'quality': 'BOOK_TABLE',
                        # How many separate figures the page prints in this
                        # cell. It is not stored in the database — the note
                        # carries the figures themselves — but the gate totals
                        # it, because a range cannot show that a value was lost
                        # from the middle of a cell. Losing 126 out of
                        # "123,126," leaves viscose reading 74-127 either way.
                        'value_count': len(vals),
                        'cell_kind': kind,
                        'note': why,
                    })
                continue
            if spec.get('tensile_check'):
                if (slug, 'work_factor') in KNOWN_BOOK_DISCREPANCIES:
                    discrepancies.append({'fibre': slug, 'table': ref, 'which': 'work factor',
                                          'note': KNOWN_BOOK_DISCREPANCIES[(slug, 'work_factor')]})
                why = tensile_slip(cells, spec, slug)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            elif spec.get('ratio_check'):
                why = ratio_slip(cells, spec)
                if why:
                    refused.append({'table': ref, 'name': label, 'why': why})
                    continue
                by_cond = {}
            elif spec.get('paired_check', True):
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

            fibres.setdefault(slug, {'slug': slug, 'name': name, 'generic_class': gclass,
                                     'origin': origin, 'polymer': polymer, 'engine_key': engine,
                                     'page': printed_page, 'printed_name': label})

            for idx, (lo, hi) in sorted(cells.items()):
                prop, cond, rh = spec['columns'][idx]
                if prop is None:
                    continue     # read so the column count matches; not stored

                # A specific-volume range is printed DESCENDING, because it is
                # the reciprocal of an ascending density range: carbon reads
                # "1.8-2.0" against "0.56-0.55". value_min and value_max have to
                # mean minimum and maximum or a query for "density under 1.5"
                # returns nonsense, so the endpoints are ordered here and the
                # reciprocal check pairs the low density with the HIGH volume.
                if hi is not None and hi < lo:
                    lo, hi = hi, lo
                # A row condition and a column condition are both real and
                # neither replaces the other: in Table 25.6(b) the row is the
                # yarn and the column is what it runs over, and the measurement
                # is only meaningful as both together.
                cond = ', '.join(x for x in (row_condition, cond) if x) or None
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
                    'temperature_c': spec.get('temperature_c'), 'method': None,
                    'source_key': SOURCE_KEY, 'page': printed_page,
                    'table_ref': 'Table ' + ref, 'book_refs': book_refs,
                    'quality': 'BOOK_TABLE', 'note': note,
                })

    # A declared table that stored nothing is a fault, never a result. Twice now
    # a table has been located, had its columns found and its rows read, and
    # then lost every one of them to a branch that did not apply — silently,
    # because a row that is skipped is not a row that is refused. Counting what
    # each table actually contributed is the only thing that catches it without
    # knowing in advance which branch went wrong.
    for ref in TABLES:
        if not any(pr['table_ref'] == 'Table ' + ref for pr in properties):
            refused.append({'table': ref, 'name': '(whole table)',
                            'why': 'the table was read but stored no measurements'})

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
