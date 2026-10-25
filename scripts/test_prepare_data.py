import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import geopandas as gpd
import requests

from prepare_data import download, write


class PreparationTests(unittest.TestCase):
    def test_download_and_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'source.json'
            response = Mock(content=b'{"features":[]}')
            with patch('prepare_data.requests.get', return_value=response) as get:
                self.assertEqual(download('https://example.org/source', path).read_bytes(), response.content)
                download('https://example.org/source', path)
                get.assert_called_once()
                response.raise_for_status.assert_called_once()

    def test_download_failure_does_not_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'source.json'
            response = Mock()
            response.raise_for_status.side_effect = requests.HTTPError('503 unavailable')
            with patch('prepare_data.requests.get', return_value=response):
                with self.assertRaises(requests.HTTPError):
                    download('https://example.org/source', path)
            self.assertFalse(path.exists())

    def test_empty_layer_is_rejected(self):
        frame = gpd.GeoDataFrame(geometry=[], crs=4326)
        with self.assertRaisesRegex(ValueError, 'empty output'):
            write(frame, 'empty')


if __name__ == '__main__':
    unittest.main()
