import { useState, useRef, useEffect } from "react";
import styled from "styled-components";
import { theme } from "../styles/theme";
import { CustomTitleBar } from "./CustomTitleBar";
import { Stepper, type Step } from "./Stepper";
import { useNavigate, useLocation } from "react-router-dom";
import { Settings, User as UserIcon } from "lucide-react";

const LayoutRoot = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
`;

const Body = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const Sidebar = styled.aside`
  width: ${theme.sizes.sidebarWidth}px;
  background: ${theme.colors.sidebar};
  border-right: 1px solid ${theme.colors.sidebarBorder};
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
`;

const SidebarHeader = styled.div`
  padding: 16px 20px 28px;
  border-bottom: 1px solid ${theme.colors.sidebarBorder};
  margin-bottom: 8px;
`;

const SidebarTitle = styled.div`
  font-size: 16px;
  font-weight: 600;
  color: ${theme.colors.text};
  margin-bottom: 4px;
`;

const SidebarSubtitle = styled.div`
  font-size: 12px;
  color: ${theme.colors.textSecondary};
`;

const SidebarStepper = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
`;

const SidebarFooter = styled.div`
  padding: 16px 20px;
  border-top: 1px solid ${theme.colors.sidebarBorder};
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: ${theme.colors.cardBg};
  }
`;

const Avatar = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: ${theme.colors.primary};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  flex-shrink: 0;
`;

const UserInfo = styled.div`
  display: flex;
  flex-direction: column;
`;

const UserName = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${theme.colors.text};
`;

const UserRole = styled.div`
  font-size: 11px;
  color: ${theme.colors.textSecondary};
`;

const Content = styled.main`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${theme.colors.bg};
`;

const UserMenu = styled.div<{ $open: boolean }>`
  position: absolute;
  bottom: calc(100% + 8px);
  left: 16px;
  right: 16px;
  background: ${theme.colors.contentBg};
  border: 1px solid ${theme.colors.sidebarBorder};
  border-radius: ${theme.sizes.borderRadius};
  padding: 6px;
  opacity: ${({ $open }) => ($open ? 1 : 0)};
  pointer-events: ${({ $open }) => ($open ? "auto" : "none")};
  transform: translateY(${({ $open }) => ($open ? "0" : "8px")});
  transition: all 0.15s ease;
  z-index: 50;
`;

const MenuItem = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: ${theme.sizes.borderRadiusSm};
  color: ${theme.colors.text};
  font-size: 13px;
  font-family: ${theme.fonts.family};
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: ${theme.colors.cardBg};
  }
`;

const MenuItemIcon = styled.div`
  color: ${theme.colors.textSecondary};
  display: flex;
`;

const steps: Step[] = [
  { id: "prepare", label: "准备素材" },
  { id: "confirm", label: "描述稿确认" },
  { id: "generate", label: "出图生成" },
  { id: "refine", label: "精细终稿" },
  { id: "deliver", label: "交付" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const pathToIndex: Record<string, number> = {
    "/prepare": 0,
    "/confirm": 1,
    "/generate": 2,
    "/refine": 3,
    "/deliver": 4,
  };

  const currentIndex = pathToIndex[location.pathname] ?? 0;

  return (
    <LayoutRoot>
      <CustomTitleBar />
      <Body>
        <Sidebar>
          <SidebarHeader>
            <SidebarTitle>出图工作台</SidebarTitle>
            <SidebarSubtitle>Spring 2026 系列</SidebarSubtitle>
          </SidebarHeader>
          <SidebarStepper>
            <Stepper
              steps={steps}
              currentStep={currentIndex}
              completedSteps={currentIndex > 0 ? Array.from({ length: currentIndex }, (_, i) => i) : []}
              onStepClick={(index) => {
                const paths = ["/prepare", "/confirm", "/generate", "/refine", "/deliver"];
                navigate(paths[index]!);
              }}
            />
          </SidebarStepper>
          <div ref={menuRef} style={{ position: "relative" }}>
            <SidebarFooter onClick={() => setMenuOpen((v) => !v)}>
              <Avatar>设计</Avatar>
              <UserInfo>
                <UserName>设计师</UserName>
                <UserRole>主理人账户</UserRole>
              </UserInfo>
            </SidebarFooter>
            <UserMenu $open={menuOpen}>
              <MenuItem onClick={() => { setMenuOpen(false); navigate("/settings"); }}>
                <MenuItemIcon><Settings size={16} /></MenuItemIcon>
                设置
              </MenuItem>
              <MenuItem onClick={() => { setMenuOpen(false); }}>
                <MenuItemIcon><UserIcon size={16} /></MenuItemIcon>
                账户
              </MenuItem>
            </UserMenu>
          </div>
        </Sidebar>
        <Content>{children}</Content>
      </Body>
    </LayoutRoot>
  );
}
