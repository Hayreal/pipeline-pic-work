import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "styled-components";
import { theme } from "./styles/theme";
import { GlobalStyle } from "./styles/GlobalStyle";
import { Layout } from "./components/Layout";
import { WorkflowProvider } from "./context/WorkflowContext";
import { PrepareMaterialsPage } from "./pages/PrepareMaterialsPage";
import { ConfirmDescriptionPage } from "./pages/ConfirmDescriptionPage";
import { GenerateImagesPage } from "./pages/GenerateImagesPage";
import { RefinePage } from "./pages/RefinePage";
import { DeliverPage } from "./pages/DeliverPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <WorkflowProvider>
        <HashRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<Navigate to="/prepare" replace />} />
              <Route path="/prepare" element={<PrepareMaterialsPage />} />
              <Route path="/confirm" element={<ConfirmDescriptionPage />} />
              <Route path="/generate" element={<GenerateImagesPage />} />
              <Route path="/refine" element={<RefinePage />} />
              <Route path="/deliver" element={<DeliverPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Layout>
        </HashRouter>
      </WorkflowProvider>
    </ThemeProvider>
  );
}
