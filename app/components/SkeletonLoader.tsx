import React from "react";

export function SkeletonBox({
  width = "100%",
  height = "16px",
  borderRadius = "4px",
  style = {},
}: {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="nitro-skeleton"
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

export function SkeletonKpiCards({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "12px", width: "100%" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="nitro-card" style={{ padding: "16px" }}>
          <SkeletonBox width="45%" height="12px" borderRadius="4px" />
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginTop: "10px" }}>
            <SkeletonBox width="60%" height="28px" borderRadius="6px" />
            <SkeletonBox width="25%" height="14px" borderRadius="10px" />
          </div>
          <div style={{ marginTop: "12px" }}>
            <SkeletonBox width="80%" height="11px" borderRadius="3px" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  columns = 6,
  columnTemplate = "minmax(220px, 2fr) 100px 110px 100px 110px 120px",
}: {
  rows?: number;
  columns?: number;
  columnTemplate?: string;
}) {
  return (
    <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden", width: "100%" }}>
      {/* Header skeleton */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: columnTemplate,
          gap: "12px",
          padding: "12px 16px",
          background: "#fafaf9",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <SkeletonBox key={i} width={i === 0 ? "50%" : "70%"} height="12px" borderRadius="3px" />
        ))}
      </div>

      {/* Rows skeleton */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          style={{
            display: "grid",
            gridTemplateColumns: columnTemplate,
            gap: "12px",
            padding: "14px 16px",
            alignItems: "center",
            borderBottom: rowIdx < rows - 1 ? "1px solid #f1f5f9" : "none",
          }}
        >
          {/* First column with avatar/icon skeleton */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <SkeletonBox width="32px" height="32px" borderRadius="50%" style={{ flex: "none" }} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
              <SkeletonBox width="75%" height="13px" borderRadius="3px" />
              <SkeletonBox width="45%" height="10px" borderRadius="3px" />
            </div>
          </div>

          {/* Remaining columns */}
          {Array.from({ length: columns - 1 }).map((_, colIdx) => (
            <div key={colIdx}>
              <SkeletonBox
                width={colIdx % 2 === 0 ? "55%" : "75%"}
                height={colIdx === columns - 2 ? "20px" : "13px"}
                borderRadius={colIdx === columns - 2 ? "12px" : "4px"}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonFunnel() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "16px", width: "100%" }}>
      <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "20px" }}>
        <SkeletonBox width="40%" height="16px" borderRadius="4px" style={{ marginBottom: "20px" }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
          <SkeletonBox width="100%" height="52px" borderRadius="6px" />
          <SkeletonBox width="92%" height="48px" borderRadius="6px" />
          <SkeletonBox width="82%" height="44px" borderRadius="6px" />
          <SkeletonBox width="70%" height="40px" borderRadius="6px" />
          <SkeletonBox width="56%" height="38px" borderRadius="6px" />
        </div>
      </div>
      <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "20px" }}>
        <SkeletonBox width="60%" height="16px" borderRadius="4px" style={{ marginBottom: "16px" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <SkeletonBox width="100%" height="70px" borderRadius="8px" />
          <SkeletonBox width="100%" height="70px" borderRadius="8px" />
          <SkeletonBox width="100%" height="70px" borderRadius="8px" />
        </div>
      </div>
    </div>
  );
}
