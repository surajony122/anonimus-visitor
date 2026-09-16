import React from "react";

export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {/* Navigation & Layout */}
        <symbol id="ic-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></symbol>
        <symbol id="ic-layers" viewBox="0 0 24 24"><path d="M12 3 21 8l-9 5-9-5 9-5Z"></path><path d="M3 13l9 5 9-5"></path></symbol>
        <symbol id="ic-sidebar" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"></rect><line x1="9.5" y1="4" x2="9.5" y2="20"></line></symbol>
        <symbol id="ic-list" viewBox="0 0 24 24"><line x1="9" y1="6" x2="20" y2="6"></line><line x1="9" y1="12" x2="20" y2="12"></line><line x1="9" y1="18" x2="20" y2="18"></line><circle cx="4.5" cy="6" r="1"></circle><circle cx="4.5" cy="12" r="1"></circle><circle cx="4.5" cy="18" r="1"></circle></symbol>
        <symbol id="ic-home" viewBox="0 0 24 24"><path d="M4 10.5 12 4l8 6.5V20H4v-9.5Z"></path><path d="M9.5 20v-6h5v6"></path></symbol>
        <symbol id="ic-chevron-right" viewBox="0 0 24 24"><polyline points="9 5 16 12 9 19"></polyline></symbol>
        <symbol id="ic-chevron-down" viewBox="0 0 24 24"><polyline points="5 9 12 16 19 9"></polyline></symbol>
        <symbol id="ic-arrow-right" viewBox="0 0 24 24"><line x1="4" y1="12" x2="19" y2="12"></line><polyline points="13 6 19 12 13 18"></polyline></symbol>
        <symbol id="ic-external-link" viewBox="0 0 24 24"><path d="M13 4h7v7"></path><line x1="20" y1="4" x2="11" y2="13"></line><path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5"></path></symbol>

        {/* People & Leads */}
        <symbol id="ic-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"></circle><path d="M4.5 20c0-3.9 3.4-6.6 7.5-6.6s7.5 2.7 7.5 6.6"></path></symbol>
        <symbol id="ic-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"></circle><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"></path><circle cx="17" cy="9" r="2.3"></circle><path d="M15.5 14.2c2.4.4 4.5 2.6 4.5 5.8"></path></symbol>
        <symbol id="ic-user-plus" viewBox="0 0 24 24"><circle cx="10" cy="8" r="3.4"></circle><path d="M3.5 20c0-3.7 2.9-6.3 6.5-6.3 1.2 0 2.3.3 3.2.8"></path><line x1="17.5" y1="13" x2="17.5" y2="20"></line><line x1="14" y1="16.5" x2="21" y2="16.5"></line></symbol>
        <symbol id="ic-user-check" viewBox="0 0 24 24"><circle cx="10" cy="8" r="3.4"></circle><path d="M3.5 20c0-3.7 2.9-6.3 6.5-6.3 1 0 2 .2 2.8.6"></path><polyline points="15 17.5 17.5 20 21 15.5"></polyline></symbol>
        <symbol id="ic-id-card" viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.5"></rect><circle cx="8.5" cy="11" r="2"></circle><path d="M5 16.5c0-1.7 1.6-2.8 3.5-2.8s3.5 1.1 3.5 2.8"></path><line x1="15" y1="10.5" x2="19" y2="10.5"></line><line x1="15" y1="14" x2="19" y2="14"></line></symbol>
        <symbol id="ic-phone" viewBox="0 0 24 24"><path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z"></path></symbol>

        {/* Messaging */}
        <symbol id="ic-message" viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4V5Z"></path></symbol>
        <symbol id="ic-messages" viewBox="0 0 24 24"><path d="M3 4h13v9H7l-4 3.5V4Z"></path><path d="M8 16v1.5h8l4 3V9.5h-4"></path></symbol>
        <symbol id="ic-mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3.5 6.5 12 13l8.5-6.5"></path></symbol>
        <symbol id="ic-send" viewBox="0 0 24 24"><path d="M21 3 3 10.5l7 2.8L12.8 21 21 3Z"></path><line x1="10" y1="13.3" x2="21" y2="3"></line></symbol>
        <symbol id="ic-bell" viewBox="0 0 24 24"><path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z"></path><path d="M10 19a2.2 2.2 0 0 0 4 0"></path></symbol>

        {/* Commerce & Jewelry */}
        <symbol id="ic-tag" viewBox="0 0 24 24"><path d="M3 3h8l10 10-8 8L3 11V3Z"></path><circle cx="7.5" cy="7.5" r="1.4"></circle></symbol>
        <symbol id="ic-package" viewBox="0 0 24 24"><path d="M3 8 12 4l9 4-9 4-9-4Z"></path><path d="M3 8v9l9 4 9-4V8"></path><line x1="12" y1="12" x2="12" y2="21"></line></symbol>
        <symbol id="ic-cart" viewBox="0 0 24 24"><path d="M2.5 4h2.2l2.6 10.5h10.4L21 7H6"></path><circle cx="9" cy="19" r="1.6"></circle><circle cx="17" cy="19" r="1.6"></circle></symbol>
        <symbol id="ic-rupee" viewBox="0 0 24 24"><path d="M7 4h10"></path><path d="M7 8.5h10"></path><path d="M14.5 4c0 3.2-1.9 4.5-4.7 4.5H7l7.5 11.5"></path></symbol>
        <symbol id="ic-diamond" viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 12L2 9Z"></path><path d="M2 9h20M9 3l3 6-3 12M15 3l-3 6 3 12"></path></symbol>
        <symbol id="ic-gem" viewBox="0 0 24 24"><path d="M12 3 20 10l-8 11L4 10 12 3Z"></path><path d="M8 7.5 12 12l4-4.5M4 10h16"></path></symbol>
        <symbol id="ic-ring" viewBox="0 0 24 24"><circle cx="12" cy="14.5" r="6"></circle><path d="M9.5 8.8 12 3l2.5 5.8"></path><path d="M9.8 8.4 12 6l2.2 2.4"></path></symbol>

        {/* Status & Feedback */}
        <symbol id="ic-check" viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"></polyline></symbol>
        <symbol id="ic-check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><polyline points="8 12 11 15 16 9"></polyline></symbol>
        <symbol id="ic-x" viewBox="0 0 24 24"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></symbol>
        <symbol id="ic-alert-triangle" viewBox="0 0 24 24"><path d="M12 3 22 20 2 20Z"></path><line x1="12" y1="9" x2="12" y2="14"></line><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"></circle></symbol>
        <symbol id="ic-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16.5"></line><circle cx="12" cy="7.8" r="0.7" fill="currentColor" stroke="none"></circle></symbol>
        <symbol id="ic-shield-check" viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 5-3.4 7.8-8 9-4.6-1.2-8-4-8-9V6l8-3Z"></path><polyline points="8.5 12 11 14.5 15.5 9.5"></polyline></symbol>

        {/* Data & Analytics */}
        <symbol id="ic-activity" viewBox="0 0 24 24"><polyline points="2 12 7 12 9 6 14 18 16 12 22 12"></polyline></symbol>
        <symbol id="ic-trending-up" viewBox="0 0 24 24"><polyline points="3 17 9 11 13 15 21 7"></polyline><polyline points="15 7 21 7 21 13"></polyline></symbol>
        <symbol id="ic-database" viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"></ellipse><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"></path><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"></path></symbol>
        <symbol id="ic-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></symbol>

        {/* System & Actions */}
        <symbol id="ic-server" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="6" rx="1.6"></rect><rect x="3" y="14" width="18" height="6" rx="1.6"></rect><line x1="7" y1="7" x2="7.01" y2="7"></line><line x1="7" y1="17" x2="7.01" y2="17"></line></symbol>
        <symbol id="ic-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"></circle><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.4.6a7.6 7.6 0 0 0-1.7-1L14.8 3h-3.9l-.5 2.7a7.6 7.6 0 0 0-1.7 1l-2.4-.6-2 3.4L6.3 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.4-.6a7.6 7.6 0 0 0 1.7 1l.5 2.7h3.9l.5-2.7a7.6 7.6 0 0 0 1.7-1l2.4.6 2-3.4-2-1.5Z"></path></symbol>
        <symbol id="ic-webhook" viewBox="0 0 24 24"><path d="M9 9a3.5 3.5 0 1 1 5 3.2L11.5 17"></path><circle cx="7" cy="18" r="2.5"></circle><circle cx="17" cy="18" r="2.5"></circle><path d="M9.5 18h5"></path><path d="M15.5 15.8 13 11"></path></symbol>
        <symbol id="ic-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M15 6V4.5A1.5 1.5 0 0 0 13.5 3H4.5A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H6"></path></symbol>
        <symbol id="ic-trash" viewBox="0 0 24 24"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M6 7l1 13h10l1-13"></path></symbol>
        <symbol id="ic-refresh" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.5 9a8.5 8.5 0 0 1 14-3.3L23 10M1 14l5.5 4.3A8.5 8.5 0 0 0 20.5 15"></path></symbol>
        <symbol id="ic-download" viewBox="0 0 24 24"><line x1="12" y1="3" x2="12" y2="15"></line><polyline points="7 10 12 15 17 10"></polyline><path d="M4 19h16"></path></symbol>
        <symbol id="ic-whatsapp" viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.3A9 9 0 1 0 12 3Z"></path><path d="M9 8.5c0 3.3 2.7 6 6 6 .8 0 1.2-.5 1.2-1.2l-1.9-1-1 1a6.6 6.6 0 0 1-2.3-2.3l1-1-1-1.9c-.7 0-2 .3-2 1.4Z"></path></symbol>
        <symbol id="ic-heart" viewBox="0 0 24 24"><path d="M12 20s-8-4.9-8-10a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.1-8 10-8 10Z"></path></symbol>
        <symbol id="ic-zap" viewBox="0 0 24 24"><path d="M13 2 6 13h5l-1 9 8-12h-5l1-8Z"></path></symbol>
      </defs>
    </svg>
  );
}
