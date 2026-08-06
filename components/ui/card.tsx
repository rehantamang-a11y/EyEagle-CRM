import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card" className={cn("rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-[var(--app-panel-shadow)]", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-header" className={cn("grid gap-1.5 px-6 pt-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h1 data-slot="card-title" className={cn("m-0 text-[21px] font-bold tracking-[-0.02em]", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p data-slot="card-description" className={cn("m-0 text-[13px] leading-5 text-[var(--muted)]", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-content" className={cn("px-6 pb-6 pt-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-footer" className={cn("flex items-center px-6 pb-6", className)} {...props} />;
}
