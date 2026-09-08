import QRCode from "qrcode";

// A tg:// link is no use to someone whose phone does not have the client that
// opens it — they need something to point a camera at. Rendering the code here
// puts it in the same tool result as the token, instead of costing another
// round trip through the agent while the ~30 second window drains.
export async function qrPngBase64(url: string): Promise<string> {
  const png = await QRCode.toBuffer(url, {
    type: "png",
    margin: 2,
    scale: 6,
    errorCorrectionLevel: "M",
  });
  return png.toString("base64");
}
