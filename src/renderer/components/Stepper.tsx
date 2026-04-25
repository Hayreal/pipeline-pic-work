import styled from "styled-components";
import { theme } from "../styles/theme";
import { Check } from "lucide-react";

const StepperContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0 16px;
`;

const StepItem = styled.div<{
  $status: "completed" | "active" | "upcoming";
  $clickable: boolean;
}>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: ${theme.sizes.borderRadiusSm};
  cursor: ${({ $clickable }) => ($clickable ? "pointer" : "default")};
  transition: background 0.15s;

  &:hover {
    background: ${({ $clickable }) => ($clickable ? theme.colors.cardBg : "transparent")};
  }
`;

const StepNumber = styled.div<{
  $status: "completed" | "active" | "upcoming";
}>`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;

  ${({ $status }) => {
    switch ($status) {
      case "completed":
        return `background: ${theme.colors.completedBg}; color: ${theme.colors.completedText};`;
      case "active":
        return `background: ${theme.colors.text}; color: ${theme.colors.bg};`;
      case "upcoming":
        return `background: transparent; border: 1px solid ${theme.colors.border}; color: ${theme.colors.textMuted};`;
    }
  }}
`;

const StepLabel = styled.span<{
  $status: "completed" | "active" | "upcoming";
}>`
  font-size: 13px;
  font-weight: 500;

  ${({ $status }) => {
    switch ($status) {
      case "completed":
        return `color: ${theme.colors.completedText};`;
      case "active":
        return `color: ${theme.colors.text}; font-weight: 600;`;
      case "upcoming":
        return `color: ${theme.colors.textMuted};`;
    }
  }}
`;

export interface Step {
  id: string;
  label: string;
}

interface StepperProps {
  steps: Step[];
  currentStep: number;
  completedSteps: number[];
  onStepClick?: (index: number) => void;
}

export function Stepper({ steps, currentStep, completedSteps, onStepClick }: StepperProps) {
  return (
    <StepperContainer>
      {steps.map((step, index) => {
        const status: "completed" | "active" | "upcoming" =
          completedSteps.includes(index)
            ? "completed"
            : index === currentStep
              ? "active"
              : "upcoming";

        const isClickable = onStepClick !== undefined && (status === "completed" || status === "active");

        return (
          <StepItem
            key={step.id}
            $status={status}
            $clickable={isClickable}
            onClick={() => isClickable && onStepClick?.(index)}
          >
            <StepNumber $status={status}>
              {status === "completed" ? <Check size={14} /> : index + 1}
            </StepNumber>
            <StepLabel $status={status}>{step.label}</StepLabel>
          </StepItem>
        );
      })}
    </StepperContainer>
  );
}
