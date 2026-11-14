export interface ReserveLocale {
  forest_id: string;
  rank: number;
  name_en: string;
  name_mm: string;
  region_en: string;
  region_mm: string;
  township_en: string;
  township_mm: string;
  forest_type_en: string;
  forest_type_mm: string;
}

export const RESERVES_LOCALE: Record<string, ReserveLocale> = {
  rf_01_panlaung: {
    forest_id: 'rf_01_panlaung',
    rank: 1,
    name_en: 'Panlaung Reserved Forest',
    name_mm: 'ပန်းလောင်ကြိုးဝိုင်းသစ်တော',
    region_en: 'Shan State / Mandalay Scarp',
    region_mm: 'ရှမ်းပြည်နယ် / မန္တလေးတိုင်း',
    township_en: 'Ywangan / Myittha',
    township_mm: 'ရွာငံ / မြစ်သား',
    forest_type_en: 'Upland Mixed Deciduous',
    forest_type_mm: 'တောင်ပေါ်ရွက်ပြတ်ရောနှောတော',
  },
  rf_02_kabaung: {
    forest_id: 'rf_02_kabaung',
    rank: 2,
    name_en: 'Kabaung Reserved Forest',
    name_mm: 'ကပေါင်းကြိုးဝိုင်းသစ်တော',
    region_en: 'Bago Region',
    region_mm: 'ပဲခူးတိုင်းဒေသကြီး',
    township_en: 'Oktwin / Taungoo',
    township_mm: 'အုတ်တွင်း / တောင်ငူ',
    forest_type_en: 'Moist Upper Mixed Deciduous',
    forest_type_mm: 'အထက်ရွက်ပြတ်ရောနှောစိုစွတ်တော',
  },
  rf_03_ngalaik: {
    forest_id: 'rf_03_ngalaik',
    rank: 3,
    name_en: 'Ngalaik Reserved Forest',
    name_mm: 'ငလိုက်ကြိုးဝိုင်းသစ်တော',
    region_en: 'Nay Pyi Taw',
    region_mm: 'နေပြည်တော်ပြည်ထောင်စုနယ်မြေ',
    township_en: 'Ottarathiri / Pyinmana',
    township_mm: 'ဥတ္တရသီရိ / ပျဉ်းမနား',
    forest_type_en: 'Mixed Deciduous Watershed',
    forest_type_mm: 'ရေဝေရေလဲ ရွက်ပြတ်ရောနှောတော',
  },
  rf_04_yenwe: {
    forest_id: 'rf_04_yenwe',
    rank: 4,
    name_en: 'Yenwe Reserved Forest',
    name_mm: 'ရဲနွယ်ကြိုးဝိုင်းသစ်တော',
    region_en: 'Bago Region',
    region_mm: 'ပဲခူးတိုင်းဒေသကြီး',
    township_en: 'Kyauktaga',
    township_mm: 'ကျောက်တံခါး',
    forest_type_en: 'Moist & Dry Upper Mixed Deciduous',
    forest_type_mm: 'အထက်ရွက်ပြတ်ရောနှောတော',
  },
  rf_05_south_zamaye: {
    forest_id: 'rf_05_south_zamaye',
    rank: 5,
    name_en: 'South Zamaye Reserved Forest',
    name_mm: 'တောင်ဇမရီကြိုးဝိုင်းသစ်တော',
    region_en: 'Bago Region',
    region_mm: 'ပဲခူးတိုင်းဒေသကြီး',
    township_en: 'Bago',
    township_mm: 'ပဲခူး',
    forest_type_en: 'Moist Upper Mixed Deciduous',
    forest_type_mm: 'အထက်ရွက်ပြတ်ရောနှောစိုစွတ်တော',
  },
  rf_06_namhton: {
    forest_id: 'rf_06_namhton',
    rank: 6,
    name_en: 'Namhton Forest Reserve',
    name_mm: 'နမ့်ထွန်သစ်တောကြိုးဝိုင်း',
    region_en: 'Kachin State',
    region_mm: 'ကချင်ပြည်နယ်',
    township_en: 'Putao',
    township_mm: 'ပူတာအို',
    forest_type_en: 'Dense Mountain Evergreen',
    forest_type_mm: 'တောင်ပေါ်အမြဲစိမ်းသစ်တော',
  },
  rf_07_yinmar: {
    forest_id: 'rf_07_yinmar',
    rank: 7,
    name_en: 'Yinmar Forest Reserve',
    name_mm: 'ယင်းမာသစ်တောကြိုးဝိုင်း',
    region_en: 'Northern Shan State',
    region_mm: 'ရှမ်းပြည်နယ် (မြောက်ပိုင်း)',
    township_en: 'Moemaik / Kyaukme',
    township_mm: 'မိုးမိတ် / ကျောက်မဲ',
    forest_type_en: 'Dry Deciduous Dipterocarp',
    forest_type_mm: 'အင်တိုင်းရွက်ပြတ်ခြောက်သွေ့တော',
  },
  rf_08_wunbaik: {
    forest_id: 'rf_08_wunbaik',
    rank: 8,
    name_en: 'Wunbaik Reserved Mangrove Forest',
    name_mm: 'ဝန်ဘိုက်ဒီရေတောကြိုးဝိုင်း',
    region_en: 'Rakhine State',
    region_mm: 'ရခိုင်ပြည်နယ်',
    township_en: 'Ramree / Kyaukpyu',
    township_mm: 'ရမ်းဗြဲ / ကျောက်ဖြူ',
    forest_type_en: 'Estuarine Mangrove',
    forest_type_mm: 'မြစ်ဝကျွန်းပေါ် ဒီရေတော',
  },
  rf_09_kadon_kani: {
    forest_id: 'rf_09_kadon_kani',
    rank: 9,
    name_en: 'Kadon Kani Reserved Forest',
    name_mm: 'ကဒုံကနိကြိုးဝိုင်းသစ်တော',
    region_en: 'Ayeyarwady Region',
    region_mm: 'ဧရာဝတီတိုင်းဒေသကြီး',
    township_en: 'Bogale',
    township_mm: 'ဘိုကလေး',
    forest_type_en: 'Deltaic Mangrove',
    forest_type_mm: 'မြစ်ဝကျွန်းပေါ် ဒီရေတော',
  },
  rf_10_pyindaye: {
    forest_id: 'rf_10_pyindaye',
    rank: 10,
    name_en: 'Pyindaye Reserved Forest',
    name_mm: 'ပြင်ဒရယ်ကြိုးဝိုင်းသစ်တော',
    region_en: 'Ayeyarwady Region',
    region_mm: 'ဧရာဝတီတိုင်းဒေသကြီး',
    township_en: 'Pyapon / Bogale',
    township_mm: 'ဖျာပုံ / ဘိုကလေး',
    forest_type_en: 'Deltaic Coastal Mangrove',
    forest_type_mm: 'ကမ်းရိုးတန်း ဒီရေတော',
  },
  bago_yoma: {
    forest_id: 'bago_yoma',
    rank: 11,
    name_en: 'Bago Yoma Region',
    name_mm: 'ပဲခူးရိုးမဒေသ',
    region_en: 'Bago Region / Nay Pyi Taw',
    region_mm: 'ပဲခူးတိုင်းဒေသကြီး / နေပြည်တော်',
    township_en: 'Taungoo / Oktwin / Bago / Tharrawaddy',
    township_mm: 'တောင်ငူ / အုတ်တွင်း / ပဲခူး / သာယာဝတီ',
    forest_type_en: 'Mixed Deciduous & Teak Hill Range',
    forest_type_mm: 'ရွက်ပြတ်ရောနှောတောနှင့် ကျွန်းတောတောင်တန်း',
  },
};

const BY_EN_NAME = new Map<string, ReserveLocale>(
  Object.values(RESERVES_LOCALE).map((item) => [item.name_en.toLowerCase(), item])
);

export function getForestName(input: any, lang: string): string {
  if (!input) return '';
  if (typeof input === 'string') {
    const byId = RESERVES_LOCALE[input];
    if (byId) return lang === 'mm' ? byId.name_mm : byId.name_en;
    const byName = BY_EN_NAME.get(input.toLowerCase());
    if (byName) return lang === 'mm' ? byName.name_mm : byName.name_en;
    return input;
  }
  const fid = input.forest_id;
  if (lang === 'mm') {
    if (input.name_mm) return input.name_mm;
    if (input.forest_name_mm) return input.forest_name_mm;
    if (fid && RESERVES_LOCALE[fid]) return RESERVES_LOCALE[fid].name_mm;
    const en = input.name_en || input.forest_name;
    if (en && BY_EN_NAME.has(en.toLowerCase())) return BY_EN_NAME.get(en.toLowerCase())!.name_mm;
  }
  return input.name_en || input.forest_name || (fid && RESERVES_LOCALE[fid]?.name_en) || '';
}

export function getRegionName(input: any, lang: string): string {
  if (!input) return '';
  const fid = typeof input === 'string' ? input : input.forest_id;
  if (lang === 'mm') {
    if (input?.region_mm) return input.region_mm;
    if (fid && RESERVES_LOCALE[fid]) return RESERVES_LOCALE[fid].region_mm;
  }
  return input?.region_en || (fid && RESERVES_LOCALE[fid]?.region_en) || '';
}

export function getForestTypeName(input: any, lang: string): string {
  if (!input) return '';
  const fid = input.forest_id;
  if (lang === 'mm') {
    if (input.forest_type_mm) return input.forest_type_mm;
    if (fid && RESERVES_LOCALE[fid]) return RESERVES_LOCALE[fid].forest_type_mm;
  }
  return input.forest_type || (fid && RESERVES_LOCALE[fid]?.forest_type_en) || '';
}
