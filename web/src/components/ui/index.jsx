// shadcn/ui-style primitives (Tailwind + Radix), kept in one file.
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as LabelPrimitive from '@radix-ui/react-label';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        outline: 'border bg-card shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        good: 'bg-good text-white shadow-sm hover:bg-good/90 dark:text-background',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-6 text-base',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export const Button = React.forwardRef(function Button({ className, variant, size, asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

export function Card({ className, ...props }) {
  return <div className={cn('rounded-xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)]', className)} {...props} />;
}
export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-1.5 p-5 pb-3 sm:p-6 sm:pb-3', className)} {...props} />;
}
export function CardTitle({ className, ...props }) {
  return <h3 className={cn('text-base font-semibold leading-none tracking-tight', className)} {...props} />;
}
export function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
export function CardContent({ className, ...props }) {
  return <div className={cn('p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />;
}

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3', {
  variants: {
    variant: {
      default: 'bg-accent text-accent-foreground',
      outline: 'border text-foreground',
      muted: 'bg-muted text-muted-foreground',
      good: 'bg-good-soft text-good-ink',
      warn: 'bg-warn-soft text-warn-ink',
      bad: 'bg-bad-soft text-bad-ink',
      solidBad: 'bg-bad text-white dark:text-background',
    },
  },
  defaultVariants: { variant: 'default' },
});
export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export const Input = React.forwardRef(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn('flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 outline-none disabled:opacity-50 aria-invalid:border-destructive', className)}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn('flex min-h-32 w-full rounded-md border border-input bg-card px-3 py-2.5 text-sm leading-relaxed shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 outline-none', className)}
      {...props}
    />
  );
});

export const NativeSelect = React.forwardRef(function NativeSelect({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn('flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 outline-none', className)}
      {...props}
    >
      {children}
    </select>
  );
});

export function Label({ className, ...props }) {
  return <LabelPrimitive.Root className={cn('text-sm font-medium leading-none', className)} {...props} />;
}

export function Tabs({ className, ...props }) {
  return <TabsPrimitive.Root className={cn('flex flex-col gap-4', className)} {...props} />;
}
export function TabsList({ className, ...props }) {
  return <TabsPrimitive.List className={cn('inline-flex h-10 w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn('inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-all cursor-pointer hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-4', className)}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }) {
  return <TabsPrimitive.Content className={cn('outline-none', className)} {...props} />;
}

export function Progress({ className, value, indicatorClassName, ...props }) {
  return (
    <ProgressPrimitive.Root className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)} value={value} {...props}>
      <ProgressPrimitive.Indicator
        className={cn('h-full rounded-full bg-primary transition-all', indicatorClassName)}
        style={{ width: Math.max(0, Math.min(100, value || 0)) + '%' }}
      />
    </ProgressPrimitive.Root>
  );
}

export function Separator({ className }) {
  return <div role="separator" className={cn('h-px w-full bg-border', className)} />;
}

export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function Alert({ className, variant = 'default', ...props }) {
  const v = {
    default: 'bg-card',
    warn: 'border-warn/30 bg-warn-soft text-warn-ink',
    bad: 'border-bad/30 bg-bad-soft text-bad-ink',
    good: 'border-good/30 bg-good-soft text-good-ink',
    info: 'border-primary/20 bg-accent text-accent-foreground',
  }[variant];
  return <div role="alert" className={cn('relative flex gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0', v, className)} {...props} />;
}

export function Table({ className, ...props }) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}
export function THead(props) { return <thead className="[&_tr]:border-b" {...props} />; }
export function TBody(props) { return <tbody className="[&_tr:last-child]:border-0" {...props} />; }
export function TR({ className, ...props }) { return <tr className={cn('border-b transition-colors hover:bg-muted/40', className)} {...props} />; }
export function TH({ className, ...props }) { return <th className={cn('h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6', className)} {...props} />; }
export function TD({ className, ...props }) { return <td className={cn('px-3 py-3 align-middle first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6', className)} {...props} />; }

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ content, children }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content sideOffset={6} className="z-50 max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md animate-in fade-in-0 zoom-in-95">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
