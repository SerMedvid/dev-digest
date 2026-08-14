/* SectionCard — one collapsible section of the tour, rendering by section id.

   The card is a lookup by id rather than five bespoke components because the
   wire contract is one flat section shape: each id fills the collections it
   needs and leaves the rest empty. A section that survived the server's
   grounding gate with nothing in it says so, instead of drawing a blank card. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Markdown } from "@devdigest/ui";
import type { IconName } from "@devdigest/ui";
import type { OnboardingSectionValue } from "@devdigest/shared";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { anchorFor, isSectionEmpty } from "../../helpers";
import { CommandRow } from "../CommandRow";
import { CriticalPathRow } from "../CriticalPathRow";
import { FirstTaskCard } from "../FirstTaskCard";
import { ReadingPathStep } from "../ReadingPathStep";
import { s } from "./styles";

const SECTION_ICON: Record<OnboardingSectionValue["id"], IconName> = {
  architecture: "Workflow",
  critical_paths: "Activity",
  run_locally: "Command",
  reading_path: "ListChecks",
  first_tasks: "Target",
};

export function SectionCard({ section }: { section: OnboardingSectionValue }) {
  const t = useTranslations("onboarding");
  const [open, setOpen] = React.useState(true);
  const Glyph = Icon[SECTION_ICON[section.id]];

  return (
    <section id={anchorFor(section.id)} style={s.card} data-testid="tour-section">
      <button type="button" style={s.head} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span style={s.glyph}>
          <Glyph size={15} />
        </span>
        <h3 style={s.title}>{section.title}</h3>
        <span style={s.chevron(open)}>
          <Icon.ChevronDown size={16} />
        </span>
      </button>

      {open ? (
        <div style={s.body}>
          {isSectionEmpty(section) ? <p style={s.empty}>{t("emptySection")}</p> : null}

          {section.body ? <Markdown>{section.body}</Markdown> : null}

          {section.diagram ? (
            <div style={s.diagram}>
              <MermaidDiagram chart={section.diagram} />
            </div>
          ) : null}

          {section.id === "reading_path"
            ? section.files.map((file, i) => (
                <ReadingPathStep key={file.path} file={file} index={i} />
              ))
            : section.files.map((file) => <CriticalPathRow key={file.path} file={file} />)}

          {section.commands.map((command, i) => (
            <CommandRow key={`${i}-${command.command}`} command={command} index={i} />
          ))}

          {section.tasks.map((task) => (
            <FirstTaskCard key={task.title} task={task} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
