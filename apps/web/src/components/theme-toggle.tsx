"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label="Switch between dark and light theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      {/* Both icons are rendered and CSS picks one, so the server and the browser agree on the markup. */}
      <Sun className="hidden dark:block" aria-hidden="true" />
      <Moon className="dark:hidden" aria-hidden="true" />
    </Button>
  );
}
