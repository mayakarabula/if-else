import { useState } from "react";
import { Button, Popover, theme } from "antd";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import { useThemeMode } from "../theme";
import { resolveIntegrationIcon } from "./ui";

export function EmojiPickerField({
  value,
  onChange,
}: {
  value: string;
  onChange: (emoji: string) => void;
}) {
  const { token } = theme.useToken();
  const { mode } = useThemeMode();
  const [open, setOpen] = useState(false);
  const glyph = resolveIntegrationIcon(value, "✈️");

  function handlePick(data: EmojiClickData) {
    onChange(data.emoji);
    setOpen(false);
  }

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomLeft"
      arrow={false}
      styles={{ container: { padding: 0 } }}
      content={
        <EmojiPicker
          onEmojiClick={handlePick}
          theme={mode === "dark" ? Theme.DARK : Theme.LIGHT}
          width={320}
          height={380}
          previewConfig={{ showPreview: false }}
          skinTonesDisabled
        />
      }
    >
      <Button
        style={{
          maxWidth: 280,
          width: "100%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 10,
          height: 36,
        }}
      >
        <span style={{ fontSize: 20, lineHeight: 1 }}>{glyph}</span>
        <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>Change emoji</span>
      </Button>
    </Popover>
  );
}
