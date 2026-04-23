export default function StubPanel(props: { title: string; comingIn: string }) {
  return (
    <div style={{
      padding: "40px 24px", textAlign: "center",
      background: "#fff", border: "1px dashed #E5E7EB", borderRadius: 12,
      color: "#98A2B3", fontSize: 14,
    }}>
      <div style={{ fontWeight: 600, color: "#475467", marginBottom: 4 }}>{props.title}</div>
      <div style={{ fontSize: 12 }}>Coming in {props.comingIn}.</div>
    </div>
  );
}
