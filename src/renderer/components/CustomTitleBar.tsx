import { useEffect, useState } from "react";
import styled from "styled-components";
import { theme } from "../styles/theme";
import { Minus, Square, X } from "lucide-react";

const TitleBar = styled.div`
  height: ${theme.sizes.titleBarHeight}px;
  background: ${theme.colors.titleBar};
  display: flex;
  align-items: center;
  padding: 0 16px;
  -webkit-app-region: drag;
  position: relative;
  z-index: 100;
  flex-shrink: 0;
`;

const TrafficLights = styled.div`
  display: flex;
  gap: 8px;
  -webkit-app-region: no-drag;
`;

const TrafficLight = styled.div<{ $color: string }>`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.9;
  transition: opacity 0.15s;

  &:hover {
    opacity: 1;
  }
`;

const TitleText = styled.div`
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 13px;
  font-weight: 500;
  color: ${theme.colors.textSecondary};
  -webkit-app-region: no-drag;
  white-space: nowrap;
`;

const WindowsControls = styled.div`
  margin-left: auto;
  display: flex;
  gap: 0;
  -webkit-app-region: no-drag;
`;

const WinBtn = styled.button`
  width: 46px;
  height: ${theme.sizes.titleBarHeight}px;
  border: none;
  background: transparent;
  color: ${theme.colors.textSecondary};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.1s;

  &:hover {
    background: ${theme.colors.cardBg};
    color: ${theme.colors.text};
  }

  &:last-child:hover {
    background: ${theme.colors.danger};
    color: #fff;
  }
`;

export function CustomTitleBar({ title = "AI 出图工作台 — 项目 #2026-0421" }) {
  const [platform, setPlatform] = useState<NodeJS.Platform>("win32");

  useEffect(() => {
    window.electronAPI.platform.get().then(setPlatform);
  }, []);

  const handleMinimize = () => window.electronAPI.window.minimize();
  const handleMaximize = () => window.electronAPI.window.maximize();
  const handleClose = () => window.electronAPI.window.close();

  const macTrafficLightColors = {
    close: "#FF5F57",
    minimize: "#FEBC2E",
    maximize: "#28CA41",
  };

  return (
    <TitleBar>
      {platform === "darwin" ? (
        <TrafficLights>
          <TrafficLight $color={macTrafficLightColors.close} onClick={handleClose} />
          <TrafficLight $color={macTrafficLightColors.minimize} onClick={handleMinimize} />
          <TrafficLight $color={macTrafficLightColors.maximize} onClick={handleMaximize} />
        </TrafficLights>
      ) : (
        <WindowsControls>
          <WinBtn onClick={handleMinimize}>
            <Minus size={16} />
          </WinBtn>
          <WinBtn onClick={handleMaximize}>
            <Square size={14} />
          </WinBtn>
          <WinBtn onClick={handleClose}>
            <X size={16} />
          </WinBtn>
        </WindowsControls>
      )}
      <TitleText>{title}</TitleText>
    </TitleBar>
  );
}
