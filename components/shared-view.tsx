"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Search,
  Filter,
  Grid3X3,
  List,
  MoreVertical,
  FileText,
  ImageIcon,
  Video,
  File,
  Clock,
  User,
  Star,
  Download,
  Share2,
  Users,
} from "lucide-react"

interface SharedDocument {
  id: string
  title: string
  type: "document" | "image" | "video" | "file"
  owner: string
  sharedDate: string
  lastModified: string
  size: string
  thumbnail?: string
  starred: boolean
}

interface SharedViewProps {
  onSwitchToDocument?: (documentId: string) => void
}

export default function SharedView({ onSwitchToDocument }: SharedViewProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [searchQuery, setSearchQuery] = useState("")

  // Mock shared documents data
  const sharedDocuments: SharedDocument[] = [
    {
      id: "shared-1",
      title: "Project Proposal 2024",
      type: "document",
      owner: "张三",
      sharedDate: "2024-01-15",
      lastModified: "2024-01-20",
      size: "2.3 MB",
      starred: true,
    },
    {
      id: "shared-2",
      title: "Design System Guidelines",
      type: "document",
      owner: "李四",
      sharedDate: "2024-01-10",
      lastModified: "2024-01-18",
      size: "1.8 MB",
      starred: false,
    },
    {
      id: "shared-3",
      title: "Team Meeting Notes",
      type: "document",
      owner: "王五",
      sharedDate: "2024-01-12",
      lastModified: "2024-01-19",
      size: "856 KB",
      starred: false,
    },
    {
      id: "shared-4",
      title: "Marketing Assets",
      type: "image",
      owner: "赵六",
      sharedDate: "2024-01-08",
      lastModified: "2024-01-16",
      size: "15.2 MB",
      starred: true,
    },
  ]

  const getFileIcon = (type: string) => {
    switch (type) {
      case "document":
        return <FileText className="w-5 h-5 text-blue-600" />
      case "image":
        return <ImageIcon className="w-5 h-5 text-green-600" />
      case "video":
        return <Video className="w-5 h-5 text-purple-600" />
      default:
        return <File className="w-5 h-5 text-gray-600" />
    }
  }

  const filteredDocuments = sharedDocuments.filter(
    (doc) =>
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.owner.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">Shared with me</h1>
          <div className="flex items-center gap-2">
            <Button variant={viewMode === "grid" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("grid")}>
              <Grid3X3 className="w-4 h-4" />
            </Button>
            <Button variant={viewMode === "list" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("list")}>
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Search and Filter Bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search shared documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <Button variant="secondary" size="sm" className="bg-gray-100 hover:bg-gray-200 text-gray-700 border-0">
            <Filter className="w-4 h-4 mr-2" />
            Filter
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4">
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredDocuments.map((doc) => (
              <div
                key={doc.id}
                className="group border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => onSwitchToDocument?.(doc.id)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {getFileIcon(doc.type)}
                    {doc.starred && <Star className="w-4 h-4 text-yellow-500 fill-current" />}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 h-auto"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </div>

                <h3 className="font-medium text-gray-900 mb-2 line-clamp-2">{doc.title}</h3>

                <div className="space-y-1 text-sm text-gray-500">
                  <div className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    <span>{doc.owner}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>Modified {doc.lastModified}</span>
                  </div>
                  <div className="text-xs text-gray-400">{doc.size}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-4 px-4 py-2 text-sm font-medium text-gray-500 border-b border-gray-200">
              <div className="col-span-5">Name</div>
              <div className="col-span-2">Owner</div>
              <div className="col-span-2">Shared</div>
              <div className="col-span-2">Modified</div>
              <div className="col-span-1">Size</div>
            </div>

            {filteredDocuments.map((doc) => (
              <div
                key={doc.id}
                className="group grid grid-cols-12 gap-4 px-4 py-3 hover:bg-gray-50 rounded-lg cursor-pointer"
                onClick={() => onSwitchToDocument?.(doc.id)}
              >
                <div className="col-span-5 flex items-center gap-3">
                  {getFileIcon(doc.type)}
                  <span className="font-medium text-gray-900">{doc.title}</span>
                  {doc.starred && <Star className="w-4 h-4 text-yellow-500 fill-current" />}
                </div>
                <div className="col-span-2 flex items-center text-sm text-gray-600">{doc.owner}</div>
                <div className="col-span-2 flex items-center text-sm text-gray-600">{doc.sharedDate}</div>
                <div className="col-span-2 flex items-center text-sm text-gray-600">{doc.lastModified}</div>
                <div className="col-span-1 flex items-center justify-between">
                  <span className="text-sm text-gray-600">{doc.size}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="sm" className="p-1 h-auto">
                      <Share2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="p-1 h-auto">
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="p-1 h-auto">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredDocuments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <Users className="w-12 h-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No shared documents</h3>
            <p className="text-gray-500 text-center max-w-md">
              Documents that others share with you will appear here. You can search, filter, and organize them just like
              in Google Drive.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
