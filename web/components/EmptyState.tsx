import { FileQuestion, Sparkles } from 'lucide-react';

interface EmptyStateProps {
  message: string;
  description?: string;
  showIcon?: boolean;
}

export function EmptyState({ message, description, showIcon = true }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
      {showIcon && (
        <div className="mb-8 relative">
          <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full animate-pulse" />
          <div className="relative bg-gradient-to-br from-card/80 to-card/60 p-8 rounded-3xl border border-border/50 backdrop-blur shadow-xl">
            <FileQuestion className="h-16 w-16 text-muted-foreground/60" strokeWidth={1.5} />
          </div>
        </div>
      )}
      <h3 className="text-2xl font-black text-foreground mb-3 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
        {message}
      </h3>
      {description && (
        <p className="text-base text-muted-foreground max-w-md leading-relaxed mb-6">
          {description}
        </p>
      )}
      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground/50 font-medium">
        <Sparkles className="h-4 w-4" />
        <span>Check back soon for new opportunities</span>
      </div>
    </div>
  );
}
