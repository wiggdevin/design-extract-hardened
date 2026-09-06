import { Clipboard, LaunchProps, showHUD, showToast, Toast } from "@raycast/api";

export default async function Command(props: LaunchProps<{ arguments: { url?: string } }>) {
  const rawUrl = (props.arguments?.url || "").trim();
  if (!rawUrl) {
    await showToast({ style: Toast.Style.Failure, title: "No URL provided" });
    return;
  }
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  const quoted = "'" + url.replace(/'/g, "'\\''") + "'";
  await Clipboard.copy(`designlang ${quoted}`);
  await showHUD("Copied `designlang …` to clipboard");
}
