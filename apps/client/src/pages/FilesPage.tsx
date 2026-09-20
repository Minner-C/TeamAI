import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Image, Popconfirm, Space, Table, Tag, Typography, Upload, message } from "antd";
import {
  CloudUploadOutlined,
  DownloadOutlined,
  FileImageOutlined,
  FileOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { api, type FileView } from "../api";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileView[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    api
      .listFiles()
      .then((r) => {
        setFiles(r.files);
        setIsAdmin(r.admin);
      })
      .catch((err) => message.error(err.message));
  }, []);

  useEffect(refresh, [refresh]);

  async function onUpload(file: File) {
    setUploading(true);
    try {
      await api.uploadFile(file);
      message.success(`「${file.name}」已上传`);
      refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onDelete(file: FileView) {
    try {
      await api.deleteFile(file.id);
      message.success("已删除");
      refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  function onDownload(file: FileView) {
    window.open(api.fileUrl(file.id), "_blank");
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<CloudUploadOutlined />}
          loading={uploading}
          onClick={() => inputRef.current?.click()}
        >
          上传文件
        </Button>
        <Button icon={<ReloadOutlined />} onClick={refresh}>
          刷新
        </Button>
        <Typography.Text type="secondary">
          单文件最大 20MB；在团队消息里发送的文件也会出现在这里
        </Typography.Text>
      </Space>
      <input
        ref={inputRef}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onUpload(f);
        }}
      />

      <Table
        rowKey="id"
        dataSource={files}
        pagination={false}
        columns={[
          {
            title: "文件名",
            dataIndex: "name",
            render: (v: string, f) => (
              <Space>
                {f.mime.startsWith("image/") ? (
                  <Image
                    src={api.fileUrl(f.id)}
                    width={36}
                    height={36}
                    style={{ objectFit: "cover", borderRadius: 4 }}
                    preview={{ mask: <FileImageOutlined /> }}
                  />
                ) : (
                  <FileOutlined style={{ fontSize: 20, color: "#1677ff" }} />
                )}
                <b>{v}</b>
              </Space>
            ),
          },
          { title: "类型", dataIndex: "mime", render: (v: string) => <Tag>{v}</Tag> },
          { title: "大小", dataIndex: "size", render: (v: number) => fmtSize(v) },
          {
            title: "上传者",
            dataIndex: "ownerName",
            render: (v: string, f) => (
              <span>
                {v}
                {isAdmin ? <Typography.Text type="secondary">（{f.ownerEmail}）</Typography.Text> : null}
              </span>
            ),
          },
          {
            title: "上传时间",
            dataIndex: "createdAt",
            render: (v: number) => new Date(v).toLocaleString("zh-CN"),
          },
          {
            title: "操作",
            render: (_, f) => (
              <Space>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => onDownload(f)}>
                  下载
                </Button>
                <Popconfirm title={`删除「${f.name}」？不可恢复`} onConfirm={() => onDelete(f)}>
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
