import React, { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5003';

function FileUpload({ onDataLoaded }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const confirmed = window.confirm(
      `📁 "${file.name}" 파일을 업로드합니다.\n\n` +
      `엑셀 데이터를 파싱하여 상품 매칭 데이터를 갱신합니다.\n\n` +
      `진행하시겠습니까?`
    );

    if (!confirmed) {
      e.target.value = '';
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post(`${API_URL}/api/upload-excel`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.success) {
        onDataLoaded(response.data.products);
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.error || '파일 업로드 실패');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileChange}
        disabled={uploading}
        className="block w-full text-sm text-gray-500
          file:mr-4 file:py-2 file:px-4
          file:rounded file:border-0
          file:text-sm file:font-semibold
          file:bg-purple-50 file:text-purple-700
          hover:file:bg-purple-100
          disabled:opacity-50"
      />

      {uploading && (
        <div className="mt-2 text-sm text-blue-600">
          📤 파일 업로드 중...
        </div>
      )}

      {error && (
        <div className="mt-2 text-sm text-red-600">
          ❌ {error}
        </div>
      )}
    </div>
  );
}

export default FileUpload;
