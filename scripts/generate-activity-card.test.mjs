import test from "node:test";
import assert from "node:assert/strict";
import {
  parseContributionHtml,
  parseProfile,
  renderSvg,
  replaceCacheVersion,
} from "./generate-activity-card.mjs";

function fixture(dayCount) {
  const start = new Date("2025-01-01T00:00:00Z");
  const cells = [];
  const tips = [];
  let total = 0;
  for (let index = 0; index < dayCount; index += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const iso = date.toISOString().slice(0, 10);
    const count = index % 17 === 0 ? 2 : 0;
    total += count;
    cells.push(`<td data-date="${iso}" id="day-${index}" data-level="${count ? 2 : 0}" class="ContributionCalendar-day">`);
    tips.push(`<tool-tip for="day-${index}">${count ? `${count} contributions` : "No contributions"} on ${iso}.</tool-tip>`);
  }
  return `<h2>${total.toLocaleString("en-US")} contributions in the last year</h2>${cells.join("")}${tips.join("")}`;
}

for (const dayCount of [365, 366]) {
  test(`parses a complete ${dayCount}-day calendar`, () => {
    const result = parseContributionHtml(fixture(dayCount));
    assert.equal(result.days.length, dayCount);
    assert.equal(result.total, result.days.reduce((sum, day) => sum + day.count, 0));
  });
}

test("rejects an incomplete calendar without producing misleading data", () => {
  assert.throws(() => parseContributionHtml(fixture(20)), /complete GitHub calendar/);
});

test("validates the public profile response", () => {
  assert.deepEqual(parseProfile({
    login: "FredMotta00",
    name: "Frederico Motta",
    public_repos: 3,
    created_at: "2025-02-24T22:32:50Z",
  }), {
    login: "FredMotta00",
    name: "Frederico Motta",
    publicRepos: 3,
    joinedYear: 2025,
  });
});

test("renders a self-contained, accessible 1400 by 400 SVG", () => {
  const { total, days } = parseContributionHtml(fixture(365));
  const svg = renderSvg({
    profile: { login: "FredMotta00", name: "Frederico Motta", publicRepos: 3, joinedYear: 2025 },
    total,
    days,
    backgroundDataUri: "data:image/png;base64,AA==",
    updatedDate: "2026-09-08",
  });
  assert.match(svg, /width="1400" height="400"/);
  assert.match(svg, /<title>Frederico Motta GitHub activity<\/title>/);
  assert.match(svg, /3 public repositories/);
  assert.match(svg, /Updated daily/);
  assert.doesNotMatch(svg, /SecretOrg|private repository|commit message/i);
});

test("updates only the README cache version", () => {
  const markdown = '<img src="./assets/github-activity.svg?v=2026-09-07" />';
  assert.equal(
    replaceCacheVersion(markdown, "2026-09-08"),
    '<img src="./assets/github-activity.svg?v=2026-09-08" />',
  );
});
