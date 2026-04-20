/**
 * Amount in words (English) for THB documents — e.g. (One thousand Baht only)
 */

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? '-' + ONES[o] : '');
}

function belowThousand(n: number): string {
  if (n < 100) return belowHundred(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  return ONES[h] + ' hundred' + (r ? ' ' + belowHundred(r) : '');
}

/** 0 .. 999_999_999 — enough for invoice totals */
function integerToEnglishWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return 'zero';
  if (n === 0) return 'zero';
  if (n < 1000) return belowThousand(n);
  if (n < 1_000_000) {
    const t = Math.floor(n / 1000);
    const r = n % 1000;
    return belowThousand(t) + ' thousand' + (r ? ' ' + belowThousand(r) : '');
  }
  if (n < 1_000_000_000) {
    const m = Math.floor(n / 1_000_000);
    const r = n % 1_000_000;
    return integerToEnglishWords(m) + ' million' + (r ? ' ' + integerToEnglishWords(r) : '');
  }
  const b = Math.floor(n / 1_000_000_000);
  const r = n % 1_000_000_000;
  return integerToEnglishWords(b) + ' billion' + (r ? ' ' + integerToEnglishWords(r) : '');
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** e.g. (One thousand two hundred thirty-four Baht and fifty-six Satang) */
export function amountToEnglishBahtText(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const baht = Math.floor(rounded);
  const satang = Math.round((rounded - baht) * 100);
  let t = '(' + capitalizeFirst(integerToEnglishWords(baht)) + ' Baht';
  if (satang === 0) {
    t += ' only)';
  } else {
    t += ' and ' + integerToEnglishWords(satang) + ' Satang)';
  }
  return t;
}
