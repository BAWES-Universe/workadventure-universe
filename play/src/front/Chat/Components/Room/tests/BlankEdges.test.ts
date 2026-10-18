import { describe, expect, it } from "vitest";
import { withoutBlankEdges } from "../BlankEdges";

describe("withoutBlankEdges", () => {
    it("drops the empty lines left after the text by Return or Shift+Enter", () => {
        expect(withoutBlankEdges("send test<br>")).toBe("send test");
        expect(withoutBlankEdges("send test<br><br><br>")).toBe("send test");
        expect(withoutBlankEdges("send test<div><br></div><div><br></div>")).toBe("send test");
        expect(withoutBlankEdges("send test\n\n")).toBe("send test");
        // Enter turns <br> into \n before sending, so the iPhone's empty <div> arrives as <div>\n</div>.
        expect(withoutBlankEdges("send test<div>\n</div><div>\n</div>")).toBe("send test");
    });

    it("drops blank lines, spaces and zero-width characters before the text", () => {
        expect(withoutBlankEdges("<br>&nbsp; ​send test")).toBe("send test");
        expect(withoutBlankEdges("\n\n send test \n")).toBe("send test");
    });

    it("keeps the line breaks inside the message", () => {
        expect(withoutBlankEdges("first line<br><br>second line<br>")).toBe("first line<br><br>second line");
        expect(withoutBlankEdges("<div>first</div><div><br></div><div>second</div>")).toBe(
            "<div>first</div><div><br></div><div>second</div>"
        );
        expect(withoutBlankEdges("first\n\nsecond")).toBe("first\n\nsecond");
    });

    it("leaves nothing when the message is only blank", () => {
        expect(withoutBlankEdges("<br>&nbsp;\n")).toBe("");
    });
});
