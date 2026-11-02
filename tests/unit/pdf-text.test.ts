import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({getDocument:vi.fn(),destroy:vi.fn(),read:vi.fn()}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs",()=>({getDocument:mocks.getDocument}));
import { pdfText, pdfTextAndItems } from "../../src/lib/sec/pdf-text.js";
beforeEach(()=>{vi.clearAllMocks();mocks.destroy.mockResolvedValue(undefined);});
function fixture(pages:string[]) {
  mocks.read.mockImplementation(async(p:number)=>({items:[{str:pages[p-1],transform:[1,0,0,1,72,700-p]}]}));
  mocks.getDocument.mockReturnValue({promise:Promise.resolve({numPages:pages.length,getPage:async(p:number)=>({getTextContent:()=>mocks.read(p)})}),destroy:mocks.destroy});
}
it("builds filing text and positioned fields from one PDF load and one read per page",async()=>{
  fixture(["Synthetic officer", "Chief Compliance Officer"]);
  const result=await pdfTextAndItems(Buffer.from("fixture"));
  expect(result).toEqual({text:"Synthetic officer\nChief Compliance Officer",items:[{page:1,x:72,y:699,str:"Synthetic officer"},{page:2,x:72,y:698,str:"Chief Compliance Officer"}]});
  expect(mocks.getDocument).toHaveBeenCalledTimes(1);expect(mocks.read).toHaveBeenCalledTimes(2);expect(mocks.destroy).toHaveBeenCalledTimes(1);
});
it("retains separate view limits without reading extra pages for text-only requests",async()=>{
  fixture(["x".repeat(200001),"Later positioned field"]);
  const both=await pdfTextAndItems(Buffer.from("fixture"));expect(both.text).toHaveLength(200001);expect(both.items).toHaveLength(2);
  mocks.read.mockClear();expect(await pdfText(Buffer.from("fixture"))).toHaveLength(200001);expect(mocks.read).toHaveBeenCalledTimes(1);
});
it("releases PDF resources when extraction fails",async()=>{
  fixture(["page"]);mocks.read.mockRejectedValueOnce(new Error("broken page"));
  await expect(pdfTextAndItems(Buffer.from("fixture"))).rejects.toThrow("broken page");expect(mocks.destroy).toHaveBeenCalledTimes(1);
});
