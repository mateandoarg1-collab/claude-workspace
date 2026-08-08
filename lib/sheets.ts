import { google } from 'googleapis';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function currentTabName(): string {
  const now = new Date();
  const mes = MESES[now.getMonth()];
  const yy = String(now.getFullYear()).slice(-2);
  return `${mes} ${yy}`;
}

function parseMonto(raw: string | undefined): number {
  if (!raw) return 0;
  return Number(raw.replace(/\$/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}

export async function getMayoristaSummary() {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
  const auth = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    ? new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY), scopes })
    : new google.auth.GoogleAuth({ keyFile: '/Users/jpcipolletta/.claude/.mateando-credentials.json', scopes });
  const sheets = google.sheets({ version: 'v4', auth });
  const tab = currentTabName();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tab}'!A2:M2`,
  });

  const row = res.data.values?.[0] ?? [];
  const orders = Number(row[0]) || 0;
  const amount = parseMonto(row[12]); // columna M: MONTO TOTAL

  return { tab, orders, amount };
}
