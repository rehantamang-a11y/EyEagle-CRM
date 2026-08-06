"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="ui-dialog-overlay" />
    <DialogPrimitive.Content className={cn("ui-dialog-content", className)} {...props}>
      {children}
      <DialogPrimitive.Close className="ui-dialog-close" aria-label="Close"><X size={17} /></DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>;
}

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("ui-dialog-header", className)} {...props} />;
export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("ui-dialog-footer", className)} {...props} />;
export const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} className={cn("ui-dialog-title", className)} {...props} />);
DialogTitle.displayName = "DialogTitle";
export const DialogDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} className={cn("ui-dialog-description", className)} {...props} />);
DialogDescription.displayName = "DialogDescription";
