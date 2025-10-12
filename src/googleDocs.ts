import fs from "node:fs";

import { google, docs_v1 } from "googleapis";
import type { JWT, OAuth2Client } from "google-auth-library";

import { appConfig, type GoogleConfiguration } from "./config";
import { type TLessonPack } from "./schemas";

type DocsRequest = docs_v1.Schema$Request;

type PublishResult = {
  docId: string;
  docUrl: string;
};

const DOCS_SCOPE = "https://www.googleapis.com/auth/documents";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

async function getAuthClient(
  config: GoogleConfiguration
): Promise<JWT | OAuth2Client | null> {
  if (config.mode === "none") {
    return null;
  }

  if (config.mode === "service-account") {
    const { serviceAccount } = config;
    return new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: [DOCS_SCOPE, DRIVE_SCOPE],
    });
  }

  const {
    oauth: { clientId, clientSecret, redirectUri, tokenPath },
  } = config;
  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri,
  });

  if (!fs.existsSync(tokenPath)) {
    throw new Error(
      `OAuth token file not found at ${tokenPath}. Generate one with npm run auth:oauth.`
    );
  }

  const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

class DocsBuilder {
  index = 1;
  private readonly requests: DocsRequest[] = [];

  getRequests(): DocsRequest[] {
    return this.requests;
  }

  addHeading(level: 1 | 2 | 3 | 4, text: string) {
    const headingText = `${text}\n`;
    this.requests.push({
      insertText: {
        location: { index: this.index },
        text: headingText,
      },
    });
    this.requests.push({
      updateParagraphStyle: {
        range: {
          startIndex: this.index,
          endIndex: this.index + headingText.length,
        },
        paragraphStyle: {
          namedStyleType: `HEADING_${level}`,
        },
        fields: "namedStyleType",
      },
    });
    this.index += headingText.length;
  }

  addParagraph(text: string) {
    const paragraphText = text.length > 0 ? `${text}\n` : "\n";
    this.requests.push({
      insertText: {
        location: { index: this.index },
        text: paragraphText,
      },
    });
    this.index += paragraphText.length;
  }

  addSpacer(lines = 1) {
    this.addParagraph("".padEnd(lines, "\n"));
  }

  addBulletList(items: string[]) {
    if (!items.length) return;

    const textBlock = items.map((item) => `${item}\n`).join("");
    const startIndex = this.index;
    this.requests.push({
      insertText: {
        location: { index: this.index },
        text: textBlock,
      },
    });
    this.requests.push({
      createParagraphBullets: {
        range: {
          startIndex,
          endIndex: startIndex + textBlock.length,
        },
        bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
      },
    });
    this.index += textBlock.length;
  }

  addBoldLabelLine(label: string, text: string) {
    const line = `${label}: ${text}\n`;
    const start = this.index;
    this.requests.push({
      insertText: { location: { index: start }, text: line },
    });
    this.requests.push({
      updateTextStyle: {
        range: { startIndex: start, endIndex: start + label.length + 1 },
        textStyle: { bold: true },
        fields: "bold",
      },
    });
    this.index += line.length;
  }

  addPageBreak() {
    this.requests.push({
      insertPageBreak: { location: { index: this.index } },
    });
    this.index += 1;
  }
}

function caseHeadingLabels() {
  return appConfig.format === "AUS"
    ? { gov: "Affirmative Case", opp: "Negative Case" }
    : { gov: "Government Case",  opp: "Opposition Case" };
}

function formatArgumentSection(
  builder: DocsBuilder,
  heading: string,
  items: Array<{
    claim: string;
    mechanism: string;
    impacts: string[];
    comparative?: string | null;
    preempts?: string[] | null;
    stakeholders?: string[] | null;
    examples?: Array<{
      label: string;
      whatHappened: string;
      whyItMatters: string;
    }> | null;
  }>
) {
  builder.addHeading(2, heading);
  if (items.length === 0) {
    builder.addParagraph("(no content)");
    return;
  }

  items.forEach((argument, index) => {
    builder.addHeading(3, `${index + 1}. ${argument.claim}`);
    builder.addParagraph(`Mechanism: ${argument.mechanism}`);
    builder.addParagraph("Impacts:");
    builder.addBulletList(argument.impacts);

    if (argument.stakeholders && argument.stakeholders.length) {
      builder.addParagraph("Stakeholders affected:");
      builder.addBulletList(argument.stakeholders);
    }

    if (argument.comparative) {
      builder.addParagraph(`Comparative: ${argument.comparative}`);
    }

    if (argument.preempts && argument.preempts.length) {
      builder.addParagraph("Pre-empts:");
      builder.addBulletList(argument.preempts);
    }

    if (argument.examples && argument.examples.length) {
      builder.addParagraph("Examples:");
      argument.examples.forEach((example) => {
        builder.addParagraph(`${example.label} – ${example.whatHappened}`);
        builder.addParagraph(`Why it matters: ${example.whyItMatters}`);
      });
    }
  });
}

async function insertAndFillTable(
  docs: docs_v1.Docs,
  docId: string,
  builder: DocsBuilder,
  headers: string[],
  rows: string[][]
) {
  const start = builder.index;
  builder.getRequests().push({
    insertTable: {
      location: { index: start },
      rows: rows.length + 1,
      columns: headers.length,
    },
  });
  builder.index += 2;

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: builder.getRequests() },
  });

  const doc = await docs.documents.get({ documentId: docId });
  const bodyContent = doc.data.body?.content ?? [];
  const tableEl = [...bodyContent].reverse().find((el) => el.table);
  if (!tableEl?.table) return;

  const fill: DocsRequest[] = [];
  headers.forEach((header, col) => {
    const startIndex =
      (tableEl.table?.tableRows?.[0]?.tableCells?.[col]?.startIndex ?? 0) + 1;
    fill.push({
      insertText: { location: { index: startIndex }, text: header },
    });
    fill.push({
      updateTextStyle: {
        range: { startIndex, endIndex: startIndex + header.length },
        textStyle: { bold: true },
        fields: "bold",
      },
    });
  });

  rows.forEach((row, rowIdx) => {
    row.forEach((text, col) => {
      const startIndex =
        (tableEl.table?.tableRows?.[rowIdx + 1]?.tableCells?.[col]?.startIndex ??
          0) + 1;
      fill.push({ insertText: { location: { index: startIndex }, text } });
    });
  });

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: fill },
  });
}

function buildRequests(pack: TLessonPack): DocsRequest[] {
  const builder = new DocsBuilder();

  builder.addHeading(1, pack.title);
  if (pack.motionOrTopic) {
    builder.addParagraph(`Motion: ${pack.motionOrTopic}`);
  }
  if (pack.context) {
    builder.addParagraph(`Context: ${pack.context}`);
  }

  builder.addHeading(2, "First Principles");
  builder.addParagraph(`Burden: ${pack.firstPrinciples.burden}`);
  builder.addParagraph(`Metric: ${pack.firstPrinciples.metric}`);

  if (pack.firstPrinciples.assumptions.length) {
    builder.addParagraph("Assumptions:");
    builder.addBulletList(pack.firstPrinciples.assumptions);
  }

  if (pack.firstPrinciples.theories.length) {
    builder.addParagraph("Theories:");
    builder.addBulletList(pack.firstPrinciples.theories);
  }

  if (pack.firstPrinciples.tests) {
    builder.addParagraph("Tests:");
    builder.addBulletList(pack.firstPrinciples.tests);
  }

  const labels = caseHeadingLabels();
  formatArgumentSection(builder, labels.gov, pack.govCase);
  formatArgumentSection(builder, labels.opp, pack.oppCase);

  if (pack.counterCases && pack.counterCases.length) {
    formatArgumentSection(builder, "Counter Cases", pack.counterCases);
  }

  if (pack.extensions.length) {
    builder.addHeading(2, "Extensions");
    builder.addBulletList(pack.extensions);
  }

  if (pack.rebuttalLadders && pack.rebuttalLadders.length) {
    builder.addHeading(2, "Rebuttal Ladders");
    pack.rebuttalLadders.forEach((ladder) => {
      builder.addHeading(3, ladder.target);
      builder.addBulletList(ladder.ladder);
    });
  }

  builder.addHeading(2, "Weighing");
  builder.addParagraph(`Method: ${pack.weighing.method}`);

  if (pack.weighing.adjudicatorNotes.length) {
    builder.addParagraph("Adjudicator Notes:");
    builder.addBulletList(pack.weighing.adjudicatorNotes);
  }

  if (pack.weighing.commonPitfalls.length) {
    builder.addParagraph("Common Pitfalls:");
    builder.addBulletList(pack.weighing.commonPitfalls);
  }

  if (pack.weighing.POIAdvice && pack.weighing.POIAdvice.length) {
    builder.addParagraph("POI Advice:");
    builder.addBulletList(pack.weighing.POIAdvice);
  }

  if (pack.weighing.whipAdvice && pack.weighing.whipAdvice.length) {
    builder.addParagraph("Whip Advice:");
    builder.addBulletList(pack.weighing.whipAdvice);
  }

  if (pack.drills.length) {
    builder.addHeading(2, "Drills");
    builder.addBulletList(pack.drills);
  }

  if (pack.glossary && pack.glossary.length) {
    builder.addHeading(2, "Glossary");
    pack.glossary.forEach((item) => {
      builder.addParagraph(`${item.term}: ${item.def}`);
    });
  }

  if (pack.examplesBank.length) {
    builder.addHeading(2, "Examples Bank");
    pack.examplesBank.forEach((example) => {
      builder.addParagraph(example.label);
      builder.addParagraph(`What happened: ${example.whatHappened}`);
      builder.addParagraph(`Why it matters: ${example.whyItMatters}`);
      builder.addParagraph("How to use:");
      builder.addBulletList(example.howToUse);
    });
  }

  builder.addHeading(2, "Sources");
  pack.sources.forEach((source) => {
    builder.addParagraph(`${source.title} – ${source.url}`);
    if (source.note) {
      builder.addParagraph(`Note: ${source.note}`);
    }
  });

  if (pack.inputMetadata.filename) {
    builder.addParagraph(`Input file: ${pack.inputMetadata.filename}`);
  }

  return builder.getRequests();
}

function resolveTitle(pack: TLessonPack): string {
  if (pack.title) return pack.title;
  if (pack.motionOrTopic) return pack.motionOrTopic;
  if (pack.inputMetadata.filename) {
    return `Lesson Pack – ${pack.inputMetadata.filename}`;
  }
  return "Lesson Pack";
}

export async function publishLessonPack(
  config: GoogleConfiguration,
  pack: TLessonPack
): Promise<PublishResult | null> {
  if (config.mode === "none") {
    console.info("Google publishing disabled (no credentials configured).");
    return null;
  }

  const auth = await getAuthClient(config);
  if (!auth) {
    console.info("Google publishing disabled (no auth client).");
    return null;
  }

  const drive = google.drive({ version: "v3", auth });
  const docs = google.docs({ version: "v1", auth });

  const title = resolveTitle(pack);
  const parents = config.exportFolderId ? [config.exportFolderId] : undefined;

  const createResponse = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: "application/vnd.google-apps.document",
      parents,
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  const docId = createResponse.data.id;
  if (!docId) {
    throw new Error("Failed to create Google Doc – no file ID returned");
  }

  const requests = buildRequests(pack);
  if (requests.length) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    });
  }

  return {
    docId,
    docUrl:
      createResponse.data.webViewLink ??
      `https://docs.google.com/document/d/${docId}/edit`,
  };
}
