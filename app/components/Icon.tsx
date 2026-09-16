import React from "react";

interface IconProps {
  name: string;
  size?: number | string;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function Icon({ name, size = 16, color = "currentColor", className, style }: IconProps) {
  const iconHref = name.startsWith("#") ? name : `#${name}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
    >
      <use href={iconHref} />
    </svg>
  );
}
