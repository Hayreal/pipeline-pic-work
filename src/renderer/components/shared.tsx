import styled from "styled-components";
import { theme } from "../styles/theme";

/* ── Button ─────────────────────────────────────────────── */

export const Button = styled.button<{
  $variant?: "primary" | "secondary" | "ghost" | "danger";
  $size?: "sm" | "md" | "lg";
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  border-radius: ${theme.sizes.borderRadiusSm};
  font-family: ${theme.fonts.family};
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;

  ${({ $variant = "primary" }) => {
    switch ($variant) {
      case "primary":
        return `
          background: ${theme.colors.primary};
          color: #FFFFFF;
          &:hover { background: ${theme.colors.primaryHover}; }
        `;
      case "secondary":
        return `
          background: ${theme.colors.contentBg};
          color: ${theme.colors.text};
          border: 1px solid ${theme.colors.border};
          &:hover { background: ${theme.colors.cardBg}; }
        `;
      case "ghost":
        return `
          background: transparent;
          color: ${theme.colors.textSecondary};
          &:hover { color: ${theme.colors.text}; }
        `;
      case "danger":
        return `
          background: transparent;
          color: ${theme.colors.textSecondary};
          &:hover { color: ${theme.colors.danger}; }
        `;
    }
  }}

  ${({ $size = "md" }) => {
    switch ($size) {
      case "sm":
        return `padding: 6px 12px; font-size: 12px;`;
      case "lg":
        return `padding: 10px 20px; font-size: 14px; border-radius: ${theme.sizes.borderRadius};`;
      default:
        return `padding: 8px 16px;`;
    }
  }}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

/* ── Toggle Switch ──────────────────────────────────────── */

export const Toggle = styled.div<{ $checked: boolean }>`
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: ${({ $checked }) =>
    $checked ? theme.colors.toggleActive : theme.colors.toggleBg};
  position: relative;
  cursor: pointer;
  transition: background 0.2s ease;
  flex-shrink: 0;

  &::after {
    content: "";
    position: absolute;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    top: 2px;
    left: ${({ $checked }) => ($checked ? "20px" : "2px")};
    transition: left 0.2s ease;
  }
`;

/* ── Tag ────────────────────────────────────────────────── */

export const Tag = styled.span<{ $variant?: "orange" | "blue" }>`
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;

  ${({ $variant = "orange" }) =>
    $variant === "orange"
      ? `background: ${theme.colors.tagBg}; color: ${theme.colors.tagText};`
      : `background: ${theme.colors.tagBlueBg}; color: ${theme.colors.tagBlueText};`}
`;

/* ── Card ───────────────────────────────────────────────── */

export const Card = styled.div`
  background: ${theme.colors.cardBg};
  border-radius: ${theme.sizes.borderRadius};
  overflow: hidden;
  transition: all 0.15s ease;
`;
