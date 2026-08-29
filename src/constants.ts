import type { RegionId } from './types';

export const REGION_COLORS: Record<RegionId, string> = {
  hokkaido: '#63C7DA',
  tohoku: '#6FCF97',
  kanto: '#F2C94C',
  chubu: '#F2994A',
  kinki: '#EB5757',
  chugoku: '#BB6BD9',
  shikoku: '#9B8AFB',
  'kyushu-okinawa': '#2D9CDB',
};

export const SOURCE_REVISION = '58c561b557eab3a08ee7aa17b6837bcd789cdf43';
export const SOURCE_REPOSITORY = 'https://github.com/ricewin/simplify-japan-geojson';
export const PROJECTION = '+proj=laea +lat_0=36 +lon_0=138 +datum=WGS84 +units=km +no_defs';

export const BATTLE_TURN_TIME_MS = 10_000;
export const BATTLE_ATTACK_TIME_MS = 5_000;
export const BATTLE_ATTACK_REVEAL_MS = 500;
export const BATTLE_RECONNECT_GRACE_MS = 30_000;
export const BATTLE_PREFECTURE_ATTACK_START = 10;
export const BATTLE_PREFECTURE_ATTACK_INTERVAL = 5;
export const BATTLE_ROOM_ID_LENGTH = 6;
export const BATTLE_ROOM_TTL_MS = 60 * 60 * 1000;
export const BATTLE_ATTACK_NAME = '県送り';
export const BATTLE_PLATFORM_WIDTH_SCALE = 0.5;

export const PREFECTURES = [
  ['01', '北海道', 'Hokkaido', 'hokkaido'],
  ['02', '青森県', 'Aomori', 'tohoku'], ['03', '岩手県', 'Iwate', 'tohoku'],
  ['04', '宮城県', 'Miyagi', 'tohoku'], ['05', '秋田県', 'Akita', 'tohoku'],
  ['06', '山形県', 'Yamagata', 'tohoku'], ['07', '福島県', 'Fukushima', 'tohoku'],
  ['08', '茨城県', 'Ibaraki', 'kanto'], ['09', '栃木県', 'Tochigi', 'kanto'],
  ['10', '群馬県', 'Gunma', 'kanto'], ['11', '埼玉県', 'Saitama', 'kanto'],
  ['12', '千葉県', 'Chiba', 'kanto'], ['13', '東京都', 'Tokyo', 'kanto'],
  ['14', '神奈川県', 'Kanagawa', 'kanto'],
  ['15', '新潟県', 'Niigata', 'chubu'], ['16', '富山県', 'Toyama', 'chubu'],
  ['17', '石川県', 'Ishikawa', 'chubu'], ['18', '福井県', 'Fukui', 'chubu'],
  ['19', '山梨県', 'Yamanashi', 'chubu'], ['20', '長野県', 'Nagano', 'chubu'],
  ['21', '岐阜県', 'Gifu', 'chubu'], ['22', '静岡県', 'Shizuoka', 'chubu'],
  ['23', '愛知県', 'Aichi', 'chubu'], ['24', '三重県', 'Mie', 'chubu'],
  ['25', '滋賀県', 'Shiga', 'kinki'], ['26', '京都府', 'Kyoto', 'kinki'],
  ['27', '大阪府', 'Osaka', 'kinki'], ['28', '兵庫県', 'Hyogo', 'kinki'],
  ['29', '奈良県', 'Nara', 'kinki'], ['30', '和歌山県', 'Wakayama', 'kinki'],
  ['31', '鳥取県', 'Tottori', 'chugoku'], ['32', '島根県', 'Shimane', 'chugoku'],
  ['33', '岡山県', 'Okayama', 'chugoku'], ['34', '広島県', 'Hiroshima', 'chugoku'],
  ['35', '山口県', 'Yamaguchi', 'chugoku'],
  ['36', '徳島県', 'Tokushima', 'shikoku'], ['37', '香川県', 'Kagawa', 'shikoku'],
  ['38', '愛媛県', 'Ehime', 'shikoku'], ['39', '高知県', 'Kochi', 'shikoku'],
  ['40', '福岡県', 'Fukuoka', 'kyushu-okinawa'], ['41', '佐賀県', 'Saga', 'kyushu-okinawa'],
  ['42', '長崎県', 'Nagasaki', 'kyushu-okinawa'], ['43', '熊本県', 'Kumamoto', 'kyushu-okinawa'],
  ['44', '大分県', 'Oita', 'kyushu-okinawa'], ['45', '宮崎県', 'Miyazaki', 'kyushu-okinawa'],
  ['46', '鹿児島県', 'Kagoshima', 'kyushu-okinawa'], ['47', '沖縄県', 'Okinawa', 'kyushu-okinawa'],
] as const satisfies ReadonlyArray<readonly [string, string, string, RegionId]>;
