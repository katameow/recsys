"use client";

import { 
  MessageSquareText, 
  SquareM, 
  Twitch, 
  AlignStartHorizontal, 
  UserRoundMinus, 
  MessagesSquare, 
  GalleryThumbnails, 
  Cloud 
} from "lucide-react";

const companies = [
  { name: "Discord", icon: MessageSquareText },
  { name: "Mailchimp", icon: SquareM },
  { name: "Grammarly", icon: Twitch },
  { name: "Attentive", icon: AlignStartHorizontal },
  { name: "HelloSign", icon: UserRoundMinus },
  { name: "Intercom", icon: MessagesSquare },
  { name: "Square", icon: GalleryThumbnails },
  { name: "Dropbox", icon: Cloud },
];

export function CompanyLogos() {
  return (
    <div className="grid grid-cols-4 gap-6">
      {companies.map((company) => {
        const IconComponent = company.icon;
        return (
          <div
            key={company.name}
            className="flex items-center justify-center p-3 rounded-lg bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-colors"
          >
            <IconComponent className="w-6 h-6 text-white/80" />
          </div>
        );
      })}
    </div>
  );
}