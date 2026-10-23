import { describe, expect, it } from "vitest";
import { demoteHeadings } from "../src";

describe("demoteHeadings", () => {
	it("shifts ATX heading levels by the given offset", () => {
		const input = "# Title\n\n## Section\n\nbody text\n";
		const output = demoteHeadings(input, 2);
		expect(output).toContain("### Title");
		expect(output).toContain("#### Section");
		expect(output).toContain("body text");
	});

	it("keeps existing heading serialization stable across toolchain updates", () => {
		expect(demoteHeadings("### **example_name**\n", 2)).toBe("##### **example\\_name**\n");
	});

	it("clamps depth at 6", () => {
		const input = "##### Deep\n";
		const output = demoteHeadings(input, 2);
		expect(output).toContain("###### Deep");
	});

	it("does not touch headings inside fenced code blocks", () => {
		const input = "# Real heading\n\n```md\n# fake heading in code\n```\n";
		const output = demoteHeadings(input, 2);
		expect(output).toContain("### Real heading");
		expect(output).toContain("# fake heading in code");
		expect(output).not.toContain("### fake heading in code");
	});

	it("does not touch headings inside indented code blocks", () => {
		const input = "# Real heading\n\n    # indented code, not a heading\n";
		const output = demoteHeadings(input, 2);
		expect(output).toContain("### Real heading");
		expect(output).toContain("    # indented code, not a heading");
	});

	it("demotes headings nested inside blockquotes and lists", () => {
		const input = "> # Quoted heading\n> body\n\n- item\n  # List heading\n";
		const output = demoteHeadings(input, 2);
		expect(output).toContain("> ### Quoted heading");
		expect(output).toContain("> body");
		expect(output).toContain("### List heading");
	});

	it("returns content unchanged when there are no headings", () => {
		const input = "just a plain paragraph\nwith two lines\n";
		expect(demoteHeadings(input, 2)).toBe(input);
	});

	it("returns content unchanged when offset is zero", () => {
		const input = "# Title\n";
		expect(demoteHeadings(input, 0)).toBe(input);
	});
});
