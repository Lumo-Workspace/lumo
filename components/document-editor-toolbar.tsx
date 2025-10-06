"use client"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { 
  PanelRight, 
  PanelRightClose, 
  Bold, 
  Italic, 
  Underline, 
  Strikethrough,
  List,
  ListOrdered,
  Code,
  Code2,
  Link,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Image
} from "lucide-react"

interface DocumentEditorToolbarProps {
  onFormat: (command: string, value?: string) => void
  onAddTask: () => void
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  isAutoSaving: boolean
  lastSaved: Date | null
}

export function DocumentEditorToolbar({
  onFormat,
  onAddTask,
  isSidebarOpen,
  onToggleSidebar,
  isAutoSaving,
  lastSaved,
}: DocumentEditorToolbarProps) {
  return (
    <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Document Editor</h1>

        {/* Save Status */}
        <div className="flex items-center gap-2 text-sm">
          {isAutoSaving ? (
            <div className="flex items-center gap-2 text-blue-600">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span>Saving...</span>
            </div>
          ) : lastSaved ? (
            <span className="text-green-600">Saved {lastSaved.toLocaleTimeString()}</span>
          ) : (
            <span className="text-gray-500">Not saved</span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1">
        {/* Heading Selector */}
        <Select onValueChange={(value) => onFormat("formatBlock", value)}>
          <SelectTrigger className="w-[60px] h-8">
            <SelectValue placeholder="H4" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="div">Normal</SelectItem>
            <SelectItem value="h1">H1</SelectItem>
            <SelectItem value="h2">H2</SelectItem>
            <SelectItem value="h3">H3</SelectItem>
            <SelectItem value="h4">H4</SelectItem>
            <SelectItem value="h5">H5</SelectItem>
            <SelectItem value="h6">H6</SelectItem>
          </SelectContent>
        </Select>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Lists */}
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("insertUnorderedList")} 
          className="h-8 w-8 p-0"
          title="Bullet List"
        >
          <List className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("insertOrderedList")} 
          className="h-8 w-8 p-0"
          title="Numbered List"
        >
          <ListOrdered className="h-4 w-4" />
        </Button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Text Formatting */}
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("bold")} 
          className="h-8 w-8 p-0"
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("italic")} 
          className="h-8 w-8 p-0"
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("underline")} 
          className="h-8 w-8 p-0"
          title="Underline (Ctrl+U)"
        >
          <Underline className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("strikeThrough")} 
          className="h-8 w-8 p-0"
          title="Strikethrough"
        >
          <Strikethrough className="h-4 w-4" />
        </Button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Code */}
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("insertText", "`")} 
          className="h-8 w-8 p-0"
          title="Inline Code"
        >
          <Code className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("formatBlock", "pre")} 
          className="h-8 w-8 p-0"
          title="Code Block"
        >
          <Code2 className="h-4 w-4" />
        </Button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Link */}
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => {
            const url = prompt("Enter URL:");
            if (url) onFormat("createLink", url);
          }} 
          className="h-8 w-8 p-0"
          title="Insert Link"
        >
          <Link className="h-4 w-4" />
        </Button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Alignment */}
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("justifyLeft")} 
          className="h-8 w-8 p-0"
          title="Align Left"
        >
          <AlignLeft className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("justifyCenter")} 
          className="h-8 w-8 p-0"
          title="Align Center"
        >
          <AlignCenter className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("justifyRight")} 
          className="h-8 w-8 p-0"
          title="Align Right"
        >
          <AlignRight className="h-4 w-4" />
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => onFormat("justifyFull")} 
          className="h-8 w-8 p-0"
          title="Justify"
        >
          <AlignJustify className="h-4 w-4" />
        </Button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Media */}
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => {
            const url = prompt("Enter image URL:");
            if (url) {
              const img = document.createElement('img');
              img.src = url;
              img.alt = 'Image';
              img.style.maxWidth = '100%';
              img.style.height = 'auto';
              document.execCommand('insertHTML', false, img.outerHTML);
            }
          }} 
          className="h-8 w-8 p-0"
          title="Insert Image"
        >
          <Image className="h-4 w-4" />
        </Button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Task and Sidebar */}
        <Button variant="outline" size="sm" onClick={onAddTask} className="ml-2">
          + Task
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onToggleSidebar}
          className="ml-2"
          title={isSidebarOpen ? "Hide task panel" : "Show task panel"}
        >
          {isSidebarOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
