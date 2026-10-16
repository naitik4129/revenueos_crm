import { describe, expect, it } from "vitest";
import { markTokensHtml, splitTokens } from "./template-preview";

describe("template preview highlighting", () => {
  it("splits plain text around unfilled tokens", () => {
    expect(splitTokens("Hi {{contact.nickname}}, see {{ meeting.date }}")).toEqual([
      { text: "Hi ", token: false },
      { text: "{{contact.nickname}}", token: true },
      { text: ", see ", token: false },
      { text: "{{ meeting.date }}", token: true },
    ]);
  });

  it("marks tokens in HTML text but never inside attributes", () => {
    const html = markTokensHtml(
      '<p title="{{deal.stage}}">Hello {{contact.nickname}} &amp; co</p>',
    );
    expect(html).toContain('<p title="{{deal.stage}}">Hello <mark');
    expect(html).toContain(">{{contact.nickname}}</mark> &amp; co</p>");
  });
});
