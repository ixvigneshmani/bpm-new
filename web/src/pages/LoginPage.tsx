import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import LoginBrand from "../components/login/login-brand";
import LoginForm from "../components/login/login-form";

export default function LoginPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/home", { replace: true });
  }, [user, navigate]);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <LoginBrand />
      <LoginForm />
    </div>
  );
}
