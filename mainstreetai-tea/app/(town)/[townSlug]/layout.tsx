import "../../globals.css";
import type { ReactNode } from "react";
import { TownHeader } from "../../../components/town/TownHeader";
import { PresenceBar } from "../../../components/town/PresenceBar";
import { TownThemeProvider } from "../../../lib/theme/TownThemeProvider";
import { getTownThemeBySlug } from "../../../lib/theme/themeTypes";

type TownLayoutProps = {
  children: ReactNode;
  params: {
    townSlug: string;
  };
};

export default async function TownLayout({ children, params }: TownLayoutProps) {
  const town = await getTownThemeBySlug(params.townSlug);

  return (
    <TownThemeProvider town={town}>
      <main className="px-4 md:px-6">
        <div className="mx-auto max-w-xl md:max-w-2xl py-6 space-y-6">
          <TownHeader
            displayName={town.displayName}
            poweredByLine={town.poweredByLine}
            logoUrl={town.logoUrl}
          />
          <PresenceBar line={town.presenceLine} />
          {children}
        </div>
      </main>
    </TownThemeProvider>
  );
}
