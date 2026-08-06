"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root data-slot="label" className={cn("text-xs font-bold leading-none text-[var(--muted)]", className)} {...props} />;
}
