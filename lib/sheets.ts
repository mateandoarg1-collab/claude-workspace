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

export function getAuth() {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  return process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    ? new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY), scopes })
    : new google.auth.GoogleAuth({ keyFile: '/Users/jpcipolletta/.claude/.mateando-credentials.json', scopes });
}

export async function getMayoristaSummary() {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
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

const MANUAL_TAB = 'dashboard_manual';

export type EmpretiendaManualData = {
  gocuotasMonto: number;
  gocuotasCant: number;
  updatedAt: string;
};

export async function getEmpretiendaManual(): Promise<EmpretiendaManualData> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${MANUAL_TAB}'!A2:C2`,
  });
  const row = res.data.values?.[0] ?? [];
  return {
    gocuotasMonto: Number(row[0]) || 0,
    gocuotasCant: Number(row[1]) || 0,
    updatedAt: row[2] ?? '',
  };
}

export async function setEmpretiendaManual(data: Omit<EmpretiendaManualData, 'updatedAt'>) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const updatedAt = new Date().toISOString();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${MANUAL_TAB}'!A2:C2`,
    valueInputOption: 'RAW',
    requestBody: { values: [[data.gocuotasMonto, data.gocuotasCant, updatedAt]] },
  });
  return { ...data, updatedAt };
}
