/**
 * The Emerging Textiles menu, as the publisher lays it out: six sections, each a price DATABASE (the tables) and price REPORTS
 * (the written analysis), each split into fibres and yarns, with a sustainable list under each. The dashboard shows this
 * layout; a slot is "mapped" once a table of the subscription has been matched to it (by discovery, or by hand).
 *
 * This file only names the slots. It holds no price and no API name: the dataset and sheet names are the subscriber's own
 * and are learnt from the API ("Find my tables") or typed in.
 */
'use strict';

const slug = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// [kind, group, sustainable, title, country?]
const RAW = {
  cotton: ['Cotton', [
    ['database', 'Fibers', 0, 'International (New York, Cotlook A, Origins)'], ['database', 'Fibers', 0, 'China (Domestic and Imports)', 'CN'],
    ['database', 'Fibers', 0, 'India & Pakistan'], ['database', 'Fibers', 0, 'Turkey & Brazil'], ['database', 'Fibers', 0, 'Cotton Market Fundamentals (USDA)'],
    ['database', 'Fibers', 0, 'Fiber Price Comparison'], ['database', 'Fibers', 1, 'Organic, BCI & Recycled Cotton'], ['database', 'Fibers', 1, 'Sustainable Fibers Overview'],
    ['database', 'Yarns', 0, 'Cotton Yarns: International Market'], ['database', 'Yarns', 0, 'Cotton Yarns: Domestic Markets'], ['database', 'Yarns', 0, 'Bangladesh Yarn Market', 'BD'],
    ['database', 'Yarns', 0, 'China Yarn Market', 'CN'], ['database', 'Yarns', 0, 'India Yarn Market', 'IN'], ['database', 'Yarns', 0, 'Pakistan Yarn Market', 'PK'], ['database', 'Yarns', 0, 'Yarn Price Comparison'],
    ['database', 'Yarns', 1, 'Cotton Yarns: Organic & BCI'], ['database', 'Yarns', 1, 'Cotton Yarns: Regenagri & Recycled'], ['database', 'Yarns', 1, 'Bangladesh Yarn Market (sustainable)', 'BD'],
    ['database', 'Yarns', 1, 'India Yarn Market (sustainable)', 'IN'], ['database', 'Yarns', 1, 'Pakistan Yarn Market (sustainable)', 'PK'],
    ['report', 'Fibers', 0, 'Cotton Report (Weekly)'], ['report', 'Fibers', 0, 'Cotton v. Polyester Comparison'], ['report', 'Fibers', 0, 'Textile Fiber Price Comparison'],
    ['report', 'Yarns', 0, 'Cotton Yarns: International Market (report)'], ['report', 'Yarns', 0, 'Cotton Yarns: Domestic Markets (report)'], ['report', 'Yarns', 0, 'Spun Yarn Prices: Domestic Markets'],
    ['report', 'Yarns', 0, 'Bangladesh Yarn Market (report)', 'BD'], ['report', 'Yarns', 0, 'China Yarn Market (report)', 'CN'], ['report', 'Yarns', 0, 'India Yarn Market (report)', 'IN'],
    ['report', 'Yarns', 0, 'Pakistan Yarn Market (report)', 'PK'], ['report', 'Yarns', 0, 'Cotton Yarn v. Fiber Comparison'], ['report', 'Yarns', 1, 'Organic & BCI Cotton Fibers and Yarns'],
  ]],
  polyester: ['Polyester', [
    ['database', 'Fibers', 0, 'Polyester Chain (PTA, MEG, Chips)'], ['database', 'Fibers', 0, 'Polyester Staple Fibers'], ['database', 'Fibers', 0, 'Polyester Filament Yarns'],
    ['database', 'Fibers', 1, 'Recycled Polyester Staple Fibers (Re-PSF)'], ['database', 'Fibers', 1, 'Recycled Polyester Filament Yarns (Re-PFY)'],
    ['database', 'Yarns', 0, 'Polyester Spun and Blended Yarns'], ['database', 'Yarns', 0, 'Bangladesh Yarn Market (polyester)', 'BD'], ['database', 'Yarns', 0, 'China Yarn Market (polyester)', 'CN'],
    ['database', 'Yarns', 0, 'India Yarn Market (polyester)', 'IN'], ['database', 'Yarns', 0, 'Pakistan Yarn Market (polyester)', 'PK'],
    ['database', 'Yarns', 1, 'Recycled Polyester Spun Yarns'], ['database', 'Yarns', 1, 'Bangladesh Yarn Market (recycled polyester)', 'BD'], ['database', 'Yarns', 1, 'India Yarn Market (recycled polyester)', 'IN'], ['database', 'Yarns', 1, 'Pakistan Yarn Market (recycled polyester)', 'PK'],
    ['report', 'Fibers', 0, 'Polyester Market Prices in Asia (Weekly)'], ['report', 'Fibers', 0, 'Cotton v. Polyester Comparison (polyester)'], ['report', 'Fibers', 1, 'Recycled Polyester Staple Fibers (report)'], ['report', 'Fibers', 1, 'Recycled Polyester Filament Yarns (report)'],
    ['report', 'Yarns', 0, 'Spun Polyester and Blended Yarns'], ['report', 'Yarns', 0, 'Bangladesh Yarn Market (polyester report)', 'BD'], ['report', 'Yarns', 0, 'China Yarn Market (polyester report)', 'CN'],
    ['report', 'Yarns', 0, 'India Yarn Market (polyester report)', 'IN'], ['report', 'Yarns', 0, 'Pakistan Yarn Market (polyester report)', 'PK'], ['report', 'Yarns', 0, 'Polyester Fiber v. Yarn Comparison'], ['report', 'Yarns', 1, 'Recycled PSF and Spun Yarns'],
  ]],
  viscose: ['Viscose & Lyocell', [
    ['database', 'Fibers and yarns', 0, 'Viscose Fibers and Spun Yarns'], ['database', 'Fibers and yarns', 0, 'Viscose Spun and Blended Yarns'],
    ['database', 'Fibers and yarns', 1, 'Lyocell & Modal Fibers'], ['database', 'Fibers and yarns', 1, 'Lyocell & Modal Yarns'],
    ['report', 'Fibers and yarns', 0, 'Viscose Fiber & Yarn Prices'], ['report', 'Fibers and yarns', 0, 'Textile Fiber Price Comparison (viscose)'], ['report', 'Fibers and yarns', 0, 'Spun Yarn Prices: Domestic Markets (viscose)'],
    ['report', 'Fibers and yarns', 1, 'Modal & Lyocell Fibres and Yarns'],
  ]],
  nylon: ['Nylon & Spandex', [
    ['database', 'Fibers', 0, 'Nylon Fibers'], ['database', 'Fibers', 0, 'Spandex Fibers'], ['database', 'Fibers', 1, 'Recycled Nylon 6 (Re-Nylon)'],
    ['report', 'Fibers', 0, 'Nylon Market Prices'], ['report', 'Fibers', 0, 'Spandex Market Prices'], ['report', 'Fibers', 0, 'Textile Fiber Price Comparison (nylon)'],
  ]],
  wool: ['Wool & Other Fibers', [
    ['database', 'Fibers', 0, 'Wool and Acrylic Fibers'], ['database', 'Fibers', 0, 'Linen, Cashmere, Silk & Down'], ['database', 'Fibers', 1, 'Sustainable Wool (South Africa)'], ['database', 'Fibers', 1, 'Recycled Wool & Acrylic (India)'],
    ['report', 'Fibers', 0, 'Wool Market Prices'], ['report', 'Fibers', 0, 'Acrylic Market Prices'], ['report', 'Fibers', 0, 'Cashmere Market Prices'], ['report', 'Fibers', 0, 'Silk Market Prices'],
    ['report', 'Fibers', 0, 'Flax and Linen Fiber and Yarn Prices'], ['report', 'Fibers', 0, 'Down Market Prices'], ['report', 'Fibers', 0, 'Textile Fiber Price Comparison (wool)'],
  ]],
  apparel: ['Apparel & Trade', [
    ['database', 'US apparel imports', 0, 'Cotton Apparel Categories'], ['database', 'US apparel imports', 0, 'Man-Made Fiber Apparel Categories'], ['database', 'US apparel imports', 0, 'Knit Apparel Products'],
    ['database', 'US apparel imports', 0, 'Woven Apparel Products'], ['database', 'US apparel imports', 0, 'Home Textiles: Towels & Sheets'],
    ['database', 'EU clothing imports', 0, 'Knit Clothing: Categories'], ['database', 'EU clothing imports', 0, 'Woven Clothing: Categories'], ['database', 'EU clothing imports', 0, 'Knit Clothing: Products'],
    ['database', 'EU clothing imports', 0, 'Woven Clothing: Products'], ['database', 'EU clothing imports', 0, 'Home Textiles: Towels & Bed Linen'],
    ['report', 'Costs, wages and currencies', 0, 'Inflation Report'], ['report', 'Costs, wages and currencies', 0, 'Currency Report'], ['report', 'Costs, wages and currencies', 0, 'Minimum Wages'], ['report', 'Costs, wages and currencies', 0, 'China Production Costs', 'CN'],
    ['report', 'US apparel imports', 0, 'US Apparel Imports (Monthly)'], ['report', 'US apparel imports', 0, 'US Imports by Origin'], ['report', 'US apparel imports', 0, 'US Imports by Category'],
    ['report', 'US apparel imports', 0, 'US Imports: China v. Rest of World'], ['report', 'US apparel imports', 0, 'US Origin Price Comparison'],
    ['report', 'EU clothing imports', 0, 'EU Apparel Imports (Monthly)'], ['report', 'EU clothing imports', 0, 'EU Imports by Origin'], ['report', 'EU clothing imports', 0, 'EU Imports by Category'],
    ...[['China', 'CN'], ['Vietnam', 'VN'], ['Bangladesh', 'BD'], ['India', 'IN'], ['Turkey', 'TR'], ['Cambodia', 'KH'], ['Indonesia', 'ID'], ['Pakistan', 'PK'], ['Sri Lanka', 'LK'], ['Myanmar', 'MM'], ['Central America', null]]
      .map(([n, c]) => ['report', 'Apparel exports by country', 0, 'Apparel Exports: ' + n, c]),
  ]],
};

const CATEGORIES = Object.entries(RAW).map(([id, [label]]) => ({ id, label }));
const SLOTS = [];
for (const [cat, [, list]] of Object.entries(RAW)) {
  for (const [kind, group, sustainable, title, country] of list) {
    SLOTS.push({ id: `${cat}:${kind}:${slug(group)}:${slug(title)}`, category: cat, kind, group, sustainable: !!sustainable, title, country: country || null });
  }
}

/** What this slot could feed in costing, from its position on the menu (a suggestion: costing needs a table with a price per count). */
const COSTING_KEYS = ['carded_regular', 'combed_regular', 'carded_slub', 'combed_slub', 'carded_bci', 'combed_bci', 'cvc_60_40', 'pc_65_35', 'viscose_regular'];

module.exports = { CATEGORIES, SLOTS, COSTING_KEYS, slug };
