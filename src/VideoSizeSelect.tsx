import { VIDEO_SIZES } from "./lib/settings";

type Props = {
  value: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
  disabled?: boolean;
};

/** The list of video sizes: 自動 first, then the sizes grouped by orientation. */
export function VideoSizeSelect({ value, onChange, label, className, disabled }: Props) {
  return (
    <select
      aria-label={label}
      className={className}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="auto">{VIDEO_SIZES[0].label}</option>
      {["横向き", "縦向き", "正方形"].map((group) => (
        <optgroup key={group} label={group}>
          {VIDEO_SIZES.filter((v) => v.group === group).map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
