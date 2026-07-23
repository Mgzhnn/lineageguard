import type { Metadata } from "next";
import LineageGuard from "./LineageGuard";

export const metadata: Metadata = {
  title: "LineageGuard — Watch an AI claim mutate",
  description:
    "A free, local AI black-box replay that finds the first handoff where numbers, confidence, scope, or authority change.",
};

export default function Home() {
  return <LineageGuard />;
}
