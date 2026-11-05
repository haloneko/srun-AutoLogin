import type { ReactNode } from "react";
import "./Controls.css";

/// 表单行：标签（含一句说明）+ 控件。
///
/// `inline` 用于宽窗口——标签固定在左侧一列、控件占满右侧，
/// 比窄窗口里的上下堆叠更好扫读。
interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  inline?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, inline, children }: FieldProps) {
  return (
    <div className={`field${inline ? " field--inline" : ""}`}>
      <span className="field__label">
        {label}
        {hint && <span className="field__hint">{hint}</span>}
      </span>
      <span className="field__control">{children}</span>
    </div>
  );
}

/// 开关：用按钮实现 `role="switch"`，不依赖原生 checkbox 的样式覆盖
interface SwitchProps {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

export function Switch({ checked, label, disabled, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch${checked ? " switch--on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  );
}

/// 单选卡片
export interface OptionItem {
  value: string;
  label: string;
  desc?: string;
}

interface OptionGroupProps {
  /// 同组 radio 的 name，避免多组互相干扰
  name: string;
  value: string;
  options: OptionItem[];
  /// 宽窗口下横排的列数
  columns?: 2 | 3;
  onChange: (value: string) => void;
}

export function OptionGroup({ name, value, options, columns = 3, onChange }: OptionGroupProps) {
  return (
    <div className={`options options--cols-${columns}`}>
      {options.map((o) => (
        <label key={o.value} className={`option${value === o.value ? " option--on" : ""}`}>
          <input
            type="radio"
            name={name}
            className="option__radio"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span className="option__label">{o.label}</span>
          {o.desc && <span className="option__desc">{o.desc}</span>}
        </label>
      ))}
    </div>
  );
}
