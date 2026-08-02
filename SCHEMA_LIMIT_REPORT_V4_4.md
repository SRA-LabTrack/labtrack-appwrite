# Appwrite Schema Safety Report — v0.4.4

The project estimates every string attribute at up to four bytes per character and every float at eight bytes. The setup script stops before making changes if a collection exceeds the 56,000-byte safety threshold.

| Collection | Estimated bytes | Safety result |
|---|---:|---|
| profiles | 13,636 | Pass |
| materials | 34,556 | Pass |
| logs | 24,220 | Pass |
| chats | 22,936 | Pass |
| item_requests | 43,576 | Pass |
| material_borrows | 25,188 | Pass |
| suppliers | 38,796 | Pass |
| restock_requests | 35,164 | Pass |
| culture_logs | 10,116 | Pass |
| maintenance_requests | 18,856 | Pass |

The largest collection remains `item_requests` at approximately 43,576 bytes. The new maintenance collection is separate, so it does not increase the attribute budget of `materials` or `item_requests`.

The setup script calls `databases.get("labtrack")` and reuses that database. It does not call database creation and therefore cannot trigger the previous maximum-database-count error.
