/* eslint-disable @next/next/no-head-element */

export interface SummaryCompletedEmailProps {
  summaryTitle: string;
  tldrItems: string[];
  summaryLink: string;
}

const SUBJECT = "[DocuSumm] 요약이 완료되었습니다";

const containerStyle = {
  margin: "0 auto",
  maxWidth: "600px",
  padding: "24px",
  fontFamily: "Arial, sans-serif",
  color: "#111111",
};

const brandBoxStyle = {
  borderRadius: "12px",
  backgroundColor: "#f3f4f6",
  padding: "12px 16px",
};

const ctaSectionStyle = {
  marginTop: "20px",
  marginBottom: "20px",
};

const ctaButtonStyle = {
  borderRadius: "8px",
  backgroundColor: "#111827",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "700",
  textDecoration: "none",
  padding: "12px 18px",
};

const bulletStyle = {
  margin: "0 0 8px",
  fontSize: "14px",
  lineHeight: "20px",
};

const footerStyle = {
  fontSize: "12px",
  color: "#6b7280",
  lineHeight: "18px",
};

export function buildSummaryCompletedSubject(): string {
  return SUBJECT;
}

export function SummaryCompletedEmail({
  summaryTitle,
  tldrItems,
  summaryLink,
}: SummaryCompletedEmailProps) {
  const hasTldr = tldrItems.length > 0;

  return (
    <html lang="ko">
      <head />
      <body style={{ backgroundColor: "#f9fafb", margin: 0, padding: "24px 0" }}>
        <span
          style={{
            display: "none",
            visibility: "hidden",
            opacity: 0,
            color: "transparent",
            height: 0,
            width: 0,
          }}
        >
          DocuSumm 요약 작업이 완료되었습니다.
        </span>
        <div style={containerStyle}>
          <div style={brandBoxStyle}>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: "700" }}>DocuSumm</p>
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#6b7280" }}>
              요약 완료 알림
            </p>
          </div>

          <h2 style={{ margin: "24px 0 12px", fontSize: "22px" }}>
            요약이 완료되었습니다
          </h2>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: "22px", color: "#374151" }}>
            요청하신 문서 요약이 준비되었습니다. 아래 버튼을 눌러 전체 결과를 확인하세요.
          </p>
          <p style={{ margin: "12px 0 0", fontSize: "13px", color: "#4b5563" }}>
            제목: {summaryTitle}
          </p>

          <div style={ctaSectionStyle}>
            <a href={summaryLink} style={ctaButtonStyle}>
              전체 요약 보기
            </a>
          </div>

          <p style={{ margin: "0 0 10px", fontSize: "15px", fontWeight: "700" }}>TL;DR</p>
          {hasTldr ? (
            tldrItems.map((item, index) => (
              <p key={`${index}-${item}`} style={bulletStyle}>
                • {item}
              </p>
            ))
          ) : (
            <p style={bulletStyle}>• TL;DR 내용을 생성하지 못했습니다.</p>
          )}

          <hr style={{ margin: "22px 0", borderColor: "#e5e7eb" }} />
          <p style={footerStyle}>
            이 메일은 DocuSumm 요약 작업 완료 알림입니다.
          </p>
          <p style={{ ...footerStyle, marginTop: "6px" }}>DocuSumm</p>
        </div>
      </body>
    </html>
  );
}
