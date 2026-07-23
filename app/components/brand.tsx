import Link from "next/link";
import { ScissorsIcon } from "./icons";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href="/">
      <span className="brand-mark">
        <ScissorsIcon />
      </span>
      <span>
        <strong>Studio Barber</strong>
        {!compact ? <small>Otto · Novara</small> : null}
      </span>
    </Link>
  );
}

