"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => (
            <h2 className="text-xl font-semibold mt-4 mb-2" {...p} />
          ),
          h2: (p) => (
            <h3 className="text-lg font-semibold mt-4 mb-2" {...p} />
          ),
          h3: (p) => (
            <h4 className="text-base font-semibold mt-3 mb-1" {...p} />
          ),
          h4: (p) => (
            <h5 className="text-sm font-semibold mt-2 mb-1 uppercase tracking-wider text-muted" {...p} />
          ),
          p: (p) => <p className="my-2" {...p} />,
          ul: (p) => <ul className="list-disc pl-5 space-y-1 my-2" {...p} />,
          ol: (p) => <ol className="list-decimal pl-5 space-y-1 my-2" {...p} />,
          li: (p) => <li className="leading-relaxed" {...p} />,
          strong: (p) => <strong className="font-semibold" {...p} />,
          em: (p) => <em className="italic" {...p} />,
          code: (p) => (
            <code
              className="font-mono text-[0.92em] bg-slate-100 px-1 py-0.5 rounded"
              {...p}
            />
          ),
          pre: (p) => (
            <pre
              className="font-mono text-sm bg-slate-100 p-3 rounded overflow-x-auto"
              {...p}
            />
          ),
          a: (p) => (
            <a
              className="underline text-accent hover:opacity-80"
              target="_blank"
              rel="noopener noreferrer"
              {...p}
            />
          ),
          blockquote: (p) => (
            <blockquote
              className="border-l-2 border-border pl-3 text-muted italic"
              {...p}
            />
          ),
          hr: () => <hr className="my-4 border-border" />,
          table: (p) => (
            <div className="overflow-x-auto my-3">
              <table
                className="w-full text-sm border-collapse border border-border"
                {...p}
              />
            </div>
          ),
          th: (p) => (
            <th className="border border-border bg-slate-50 px-2 py-1 text-left font-semibold" {...p} />
          ),
          td: (p) => (
            <td className="border border-border px-2 py-1" {...p} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
