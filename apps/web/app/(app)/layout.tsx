import { Providers } from "../_app/providers";
import { Shell } from "../_app/shell";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}
