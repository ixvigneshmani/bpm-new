import { type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export default function Input({ label, error, className = "", id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      {label && <label htmlFor={inputId} className="block text-xs font-semibold text-gray-700 mb-1.5">{label}</label>}
      <input
        id={inputId}
        className={`w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 placeholder:text-gray-400 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed ${error ? "border-red-300 focus:border-red-400 focus:ring-red-50" : ""} ${className}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
