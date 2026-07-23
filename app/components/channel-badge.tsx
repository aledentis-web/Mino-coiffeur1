import type { BookingChannel } from "../lib/domain";
import {
  CalendarIcon,
  PhoneIcon,
  PlusIcon,
  WhatsAppIcon
} from "./icons";

const channelLabels: Record<BookingChannel, string> = {
  site: "Sito",
  whatsapp: "WhatsApp",
  voice: "Chiamata",
  manual: "Manuale"
};

export function ChannelBadge({ channel }: { channel: BookingChannel }) {
  const Icon =
    channel === "site"
      ? CalendarIcon
      : channel === "whatsapp"
        ? WhatsAppIcon
        : channel === "voice"
          ? PhoneIcon
          : PlusIcon;

  return (
    <span className={`channel-badge channel-${channel}`}>
      <Icon />
      {channelLabels[channel]}
    </span>
  );
}

